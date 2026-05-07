/**
 * Eval run orchestration.
 *
 * `runEval(agentId)` computes the current 7-day window metrics, the prior
 * 28-day baseline, computes drift flags, and persists the row to eval_runs.
 *
 * `runEvalsForAllAgents()` loops every agent. Designed to be called from
 * the cron runner (see migrations 035/039 — adds 'agent_evals' action).
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb, queryAll } from '@/lib/db';
import { computeMetrics, detectDrift, EMPTY_METRICS, type AgentMetrics, type DriftFlag } from './metrics';

const CURRENT_WINDOW_DAYS = 7;
const BASELINE_WINDOW_DAYS = 28;

export interface EvalRunRow {
  id: string;
  agent_id: string;
  window_start: string;
  window_end: string;
  metrics_json: string;
  baseline_json: string;
  drift_flags_json: string;
  created_at: string;
}

export interface EvalRunDecoded {
  id: string;
  agent_id: string;
  agent_name?: string | null;
  agent_role?: string | null;
  window_start: string;
  window_end: string;
  metrics: AgentMetrics;
  baseline: AgentMetrics;
  drift_flags: DriftFlag[];
  created_at: string;
}

export function runEval(agentId: string): EvalRunDecoded {
  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - CURRENT_WINDOW_DAYS * 86400_000).toISOString();
  const baselineEnd = windowStart;
  const baselineStart = new Date(now.getTime() - BASELINE_WINDOW_DAYS * 86400_000).toISOString();

  const metrics = computeMetrics(agentId, windowStart, windowEnd);
  const baseline = computeMetrics(agentId, baselineStart, baselineEnd);
  const drift = detectDrift(metrics, baseline);

  const id = uuidv4();
  const db = getDb();
  db.prepare(`
    INSERT INTO eval_runs (id, agent_id, window_start, window_end, metrics_json, baseline_json, drift_flags_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    id, agentId, windowStart, windowEnd,
    JSON.stringify(metrics), JSON.stringify(baseline), JSON.stringify(drift),
  );

  return {
    id, agent_id: agentId,
    window_start: windowStart, window_end: windowEnd,
    metrics, baseline, drift_flags: drift,
    created_at: new Date().toISOString(),
  };
}

export function runEvalsForAllAgents(): { agents: number; flagged: number } {
  const agents = queryAll<{ id: string }>(`SELECT id FROM agents`);
  let flagged = 0;
  for (const a of agents) {
    const result = runEval(a.id);
    if (result.drift_flags.some(f => f.regression)) flagged += 1;
  }
  return { agents: agents.length, flagged };
}

export function getLatestEval(agentId: string): EvalRunDecoded | null {
  const row = getDb().prepare(`
    SELECT id, agent_id, window_start, window_end, metrics_json, baseline_json, drift_flags_json, created_at
    FROM eval_runs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(agentId) as EvalRunRow | undefined;
  if (!row) return null;
  return decodeRow(row);
}

export function listLatestEvalPerAgent(): EvalRunDecoded[] {
  const rows = getDb().prepare(`
    SELECT e.id, e.agent_id, e.window_start, e.window_end,
           e.metrics_json, e.baseline_json, e.drift_flags_json, e.created_at,
           a.name AS agent_name, a.role AS agent_role
    FROM eval_runs e
    JOIN agents a ON a.id = e.agent_id
    JOIN (
      SELECT agent_id, MAX(created_at) AS max_at FROM eval_runs GROUP BY agent_id
    ) latest ON latest.agent_id = e.agent_id AND latest.max_at = e.created_at
    ORDER BY e.created_at DESC
  `).all() as Array<EvalRunRow & { agent_name?: string | null; agent_role?: string | null }>;
  return rows.map(r => ({
    ...decodeRow(r),
    agent_name: r.agent_name ?? null,
    agent_role: r.agent_role ?? null,
  }));
}

function decodeRow(row: EvalRunRow): EvalRunDecoded {
  return {
    id: row.id,
    agent_id: row.agent_id,
    window_start: row.window_start,
    window_end: row.window_end,
    metrics: safeParse<AgentMetrics>(row.metrics_json, EMPTY_METRICS),
    baseline: safeParse<AgentMetrics>(row.baseline_json, EMPTY_METRICS),
    drift_flags: safeParse<DriftFlag[]>(row.drift_flags_json, []),
    created_at: row.created_at,
  };
}

function safeParse<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
