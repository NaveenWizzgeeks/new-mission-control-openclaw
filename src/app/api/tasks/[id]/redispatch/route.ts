import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDb, queryOne } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { getMissionControlUrl } from '@/lib/config';
import type { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Phase 13O.2: kill any failed gateway session for this task and re-dispatch.
 *
 * Use when sync-from-gateway reports the session failed AND the work isn't
 * actually done on disk. This:
 *   1. Resets the task status to 'assigned' (preserves the assigned agent)
 *   2. Logs the redispatch as a status_changed activity
 *   3. POSTs to /api/tasks/[id]/dispatch — which builds a fresh prompt
 *      INCLUDING the mission-progress block (Phase 13L Fix 3) so the agent
 *      knows what's already been done by the team and doesn't re-scaffold.
 *
 * Note: we don't kill the gateway session explicitly — the gateway will spawn
 * a new session on dispatch with a different idempotency key. The old failed
 * session stays in history for diagnostic value.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [id]);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  if (task.status === 'done') {
    return NextResponse.json(
      { error: 'Task is already done. Use sync-from-gateway or PATCH to inbox first.', code: 'already_done' },
      { status: 409 }
    );
  }

  const db = getDb();
  const now = new Date().toISOString();

  // Reset to assigned. Preserves assigned_agent_id and convoy linkage.
  db.prepare(`UPDATE tasks SET status='assigned', planning_dispatch_error=NULL, updated_at=? WHERE id=?`).run(now, id);

  db.prepare(`
    INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
    VALUES (?, ?, ?, 'status_changed', ?, ?)
  `).run(
    uuidv4(),
    id,
    task.assigned_agent_id ?? null,
    `Re-dispatch requested. Previous status was ${task.status}.`,
    now,
  );

  const refreshed = queryOne<Task>(`SELECT * FROM tasks WHERE id = ?`, [id]);
  if (refreshed) broadcast({ type: 'task_updated', payload: refreshed });

  // Trigger fresh dispatch.
  let dispatchResult: unknown = null;
  try {
    const url = `${getMissionControlUrl()}/api/tasks/${id}/dispatch`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(30_000),
    });
    dispatchResult = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Re-dispatch failed at the dispatch route',
          dispatch_status: res.status,
          dispatch_response: dispatchResult,
        },
        { status: 502 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Re-dispatch network error',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, action: 'redispatched', dispatch: dispatchResult });
}
