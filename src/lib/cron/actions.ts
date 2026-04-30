/**
 * Cron action handlers (Phase 10). One function per action_type.
 * Each returns a result object the runner records as last_run_status.
 *
 * Errors surface as { ok:false, error }; the runner still updates last_run
 * so that a failing job doesn't constantly retry on the same minute.
 */

import { getDb, queryAll } from '@/lib/db';
import { runHealthCheckCycle } from '@/lib/agent-health';
import { summarizeFromSession } from '@/lib/memory/summarizer';
import { triggerProposal } from '@/lib/missions/autoPropose';

export type ActionType = 'codebase_scan' | 'memory_summarize' | 'agent_health_check' | 'auto_propose' | 'custom';

export interface ActionContext {
  jobId: string;
  jobName: string;
  config: Record<string, unknown>;
  /** ISO of the last successful run, for incremental work. */
  lastRun: string | null;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
  error?: string;
  detail?: Record<string, unknown>;
}

export async function dispatchAction(type: ActionType, ctx: ActionContext): Promise<ActionResult> {
  try {
    switch (type) {
      case 'agent_health_check': return await runAgentHealthCheck();
      case 'memory_summarize':   return await runMemorySummarize(ctx);
      case 'auto_propose':       return await runAutoPropose(ctx);
      case 'codebase_scan':      return runCodebaseScanStub();
      case 'custom':             return await runCustomWebhook(ctx);
      default: return { ok: false, error: `Unknown action_type: ${type}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function runAgentHealthCheck(): Promise<ActionResult> {
  // The existing agent-health cycle returns nothing — successful run = ok
  await runHealthCheckCycle();
  return { ok: true, message: 'Agent health cycle completed' };
}

async function runMemorySummarize(ctx: ActionContext): Promise<ActionResult> {
  // Pick OpenClaw sessions completed since the last run. For each, find the
  // owning agent and fire summarizeFromSession. Idempotent: the summarizer
  // dedupes within a 30-min window.
  const since = ctx.lastRun ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = queryAll<{
    id: string; agent_id: string | null; openclaw_session_id: string;
    ended_at: string | null;
  }>(
    `SELECT id, agent_id, openclaw_session_id, ended_at
     FROM openclaw_sessions
     WHERE status = 'completed' AND agent_id IS NOT NULL
       AND (ended_at IS NULL OR ended_at > ?)
     ORDER BY ended_at DESC LIMIT 100`,
    [since]
  );

  if (rows.length === 0) return { ok: true, message: 'No completed sessions to summarize' };

  const db = getDb();
  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.agent_id) continue;
    // Build the routing sessionKey using the agent's prefix.
    const agent = db.prepare(`SELECT session_key_prefix FROM agents WHERE id = ?`).get(r.agent_id) as { session_key_prefix?: string } | undefined;
    const sessionKey = `${agent?.session_key_prefix ?? 'agent:main:'}${r.openclaw_session_id}`;
    try {
      const result = await summarizeFromSession({
        sessionKey,
        agentId: r.agent_id,
        openclawSessionId: r.openclaw_session_id,
      });
      if (result.inserted) inserted += 1;
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { ok: true, message: `Summarized ${inserted} session(s), skipped ${skipped}`, detail: { inserted, skipped } };
}

async function runAutoPropose(ctx: ActionContext): Promise<ActionResult> {
  // Fire propose on EVERY in_progress mission. The harvest path (poll route)
  // and the per-mission UI loop pick the proposals up.
  const missions = queryAll<{ id: string }>(
    `SELECT id FROM convoys WHERE mission_stage = 'in_progress'`
  );
  if (missions.length === 0) return { ok: true, message: 'No in_progress missions; nothing to propose for' };

  const limit = Math.min(missions.length, Number(ctx.config?.limit ?? 5));
  let triggered = 0;
  let failures = 0;
  for (const m of missions.slice(0, limit)) {
    try {
      await triggerProposal(m.id);
      triggered += 1;
    } catch {
      failures += 1;
    }
  }
  return { ok: failures === 0, message: `Proposal requests sent: ${triggered}, failed: ${failures}`, detail: { triggered, failures } };
}

function runCodebaseScanStub(): ActionResult {
  // Codebase analyzer (Phase 5b deliverable) isn't shipped yet. Return ok
  // with a message so the cron doesn't error every tick.
  return { ok: true, message: 'Codebase scan: deferred to Phase 5b. No-op for now.' };
}

async function runCustomWebhook(ctx: ActionContext): Promise<ActionResult> {
  const url = ctx.config?.url;
  if (typeof url !== 'string' || url.trim().length === 0) {
    return { ok: false, error: 'custom action requires action_config.url' };
  }
  const method = (ctx.config?.method as string) || 'POST';
  const headers: Record<string, string> = (ctx.config?.headers as Record<string, string>) ?? { 'Content-Type': 'application/json' };
  const body = ctx.config?.body !== undefined
    ? (typeof ctx.config.body === 'string' ? ctx.config.body : JSON.stringify(ctx.config.body))
    : JSON.stringify({ jobId: ctx.jobId, jobName: ctx.jobName, firedAt: new Date().toISOString() });

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { ok: false, error: `Webhook ${method} ${url} → ${res.status}`, detail: { status: res.status } };
    }
    return { ok: true, message: `Webhook ${method} ${url} → ${res.status}`, detail: { status: res.status } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
