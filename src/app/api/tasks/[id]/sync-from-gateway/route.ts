import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDb, queryOne } from '@/lib/db';
import { broadcast } from '@/lib/events';

export const dynamic = 'force-dynamic';

interface GatewaySession {
  key?: string;
  status?: string;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  endedAt?: number | string | null;
  updatedAt?: number | string;
}

interface TaskRow {
  id: string;
  status: string;
  convoy_id: string | null;
  assigned_agent_id: string | null;
}

const TERMINAL_DONE = ['done', 'completed', 'finished'];
const TERMINAL_FAILED = ['failed', 'error', 'crashed'];

async function fetchSessionsForTask(taskId: string): Promise<GatewaySession[]> {
  const { getOpenClawClient } = await import('@/lib/openclaw/client');
  const client = getOpenClawClient();
  if (!client.isConnected()) await client.connect();
  // listSessions returns the gateway's wrapper { ts, count, sessions: [...] }
  // (not a plain array), so we unwrap defensively.
  const raw = (await client.listSessions()) as unknown;
  let arr: GatewaySession[] = [];
  if (Array.isArray(raw)) {
    arr = raw as GatewaySession[];
  } else if (raw && typeof raw === 'object') {
    const maybe = (raw as { sessions?: GatewaySession[] }).sessions;
    if (Array.isArray(maybe)) arr = maybe;
  }
  return arr.filter(s => typeof s.key === 'string' && s.key.includes(taskId));
}

/**
 * The gateway session id for a dispatch is built as
 *   mission-control-{agent.name lower, spaces→-}-{taskId}
 * (see /api/tasks/[id]/dispatch/route.ts). When a task has been worked on
 * by multiple roles (builder → tester → fixer), the gateway holds a session
 * per role and the *latest* by timestamp may belong to a previous role
 * whose turn ended cleanly (status=done) even though the task still has
 * work ahead. Filtering to the currently-assigned agent's session prefix
 * stops sync from speaking for someone else's terminal state.
 */
function expectedSessionPrefixForAgent(agentName: string, taskId: string): string {
  return `mission-control-${agentName.toLowerCase().replace(/\s+/g, '-')}-${taskId}`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const task = queryOne<TaskRow>(
    `SELECT id, status, convoy_id, assigned_agent_id FROM tasks WHERE id = ?`,
    [id],
  );
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  try {
    const sessions = await fetchSessionsForTask(id);
    return NextResponse.json({
      task_status: task.status,
      sessions: sessions.map(s => ({
        key: s.key,
        status: s.status,
        totalTokens: s.totalTokens,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Could not reach gateway', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const task = queryOne<TaskRow>(
    `SELECT id, status, convoy_id, assigned_agent_id FROM tasks WHERE id = ?`,
    [id],
  );
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  let sessions: GatewaySession[];
  try {
    sessions = await fetchSessionsForTask(id);
  } catch (err) {
    return NextResponse.json(
      { error: 'Could not reach gateway', code: 'gateway_unreachable', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  if (sessions.length === 0) {
    return NextResponse.json({ ok: true, action: 'noop', reason: 'no gateway sessions matched this task id' });
  }

  // Scope to the currently-assigned agent. Without this, "latest by
  // updatedAt" can pick a previous role's terminal session and we'd mark
  // the task done while the *current* agent is still working. Falls back
  // to the unfiltered set when no agent is assigned (rare).
  if (task.assigned_agent_id) {
    const agent = queryOne<{ name: string }>(
      'SELECT name FROM agents WHERE id = ?',
      [task.assigned_agent_id],
    );
    if (agent?.name) {
      const prefix = expectedSessionPrefixForAgent(agent.name, id);
      const scoped = sessions.filter(
        s => typeof s.key === 'string' && s.key === prefix,
      );
      if (scoped.length === 0) {
        // Current agent has no gateway session yet — they were just dispatched
        // and haven't started talking to the gateway. Don't speak for them
        // by reading someone else's terminal session.
        return NextResponse.json({
          ok: true,
          action: 'noop',
          reason: `current agent (${agent.name}) has no gateway session yet — give them a few seconds to start`,
        });
      }
      sessions = scoped;
    }
  }

  sessions.sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
  const latest = sessions[0];
  const status = (latest.status ?? '').toLowerCase();
  const tokens = latest.totalTokens ?? 0;

  if (!TERMINAL_DONE.includes(status) && !TERMINAL_FAILED.includes(status)) {
    return NextResponse.json({
      ok: true,
      action: 'noop',
      reason: `gateway session is still active (status=${status})`,
      session: { key: latest.key, status, totalTokens: tokens },
    });
  }

  const db = getDb();
  const now = new Date().toISOString();

  if (TERMINAL_DONE.includes(status)) {
    db.prepare(`UPDATE tasks SET status='done', updated_at=? WHERE id=?`).run(now, id);
    db.prepare(`
      INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
      VALUES (?, ?, ?, 'status_changed', ?, ?)
    `).run(
      uuidv4(),
      id,
      task.assigned_agent_id ?? null,
      `Sync-from-gateway: marked done (gateway ${latest.key} status=${status}, ${tokens} tokens)`,
      now,
    );

    const refreshed = queryOne<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, [id]) as Record<string, unknown> | undefined;
    if (refreshed) broadcast({ type: 'task_updated', payload: refreshed });

    if (task.convoy_id) {
      try {
        const { updateConvoyProgress, checkConvoyCompletion, dispatchReadyConvoySubtasks } = await import('@/lib/convoy');
        updateConvoyProgress(task.convoy_id);
        checkConvoyCompletion(task.convoy_id);
        dispatchReadyConvoySubtasks(task.convoy_id).catch(err =>
          console.error('[sync-from-gateway] auto-drain failed:', err)
        );
      } catch (err) {
        console.error('[sync-from-gateway] convoy update failed:', err);
      }
    }

    return NextResponse.json({
      ok: true,
      action: 'marked_done',
      session: { key: latest.key, status, totalTokens: tokens },
    });
  }

  db.prepare(`
    INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
    VALUES (?, ?, ?, 'status_changed', ?, ?)
  `).run(
    uuidv4(),
    id,
    task.assigned_agent_id ?? null,
    `Sync-from-gateway: gateway session failed (${latest.key}, status=${status}, ${tokens} tokens). Use Re-dispatch to retry.`,
    now,
  );

  return NextResponse.json({
    ok: true,
    action: 'flagged_failed',
    session: { key: latest.key, status, totalTokens: tokens },
    hint: 'POST /api/tasks/[id]/redispatch to restart',
  });
}
