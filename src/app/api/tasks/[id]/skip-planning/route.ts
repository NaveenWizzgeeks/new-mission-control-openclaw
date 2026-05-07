import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { dispatchReadyConvoySubtasks } from '@/lib/convoy';
import { broadcast } from '@/lib/events';

export const dynamic = 'force-dynamic';

/**
 * Phase 13L Fix 4: skip the per-subtask planning gate.
 *
 * Flips a subtask's status from 'planning' → 'inbox' so the convoy auto-drain
 * can pick it up. Only operates on subtasks (is_subtask=1) — parent missions
 * have their own planning flow via /api/missions/[id]/start-planning.
 *
 * After flipping, fires dispatchReadyConvoySubtasks so the unblocked subtask
 * starts immediately if dependencies are met.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const task = db.prepare(`
    SELECT id, status, is_subtask, convoy_id, title FROM tasks WHERE id = ?
  `).get(id) as { id: string; status: string; is_subtask: number; convoy_id: string | null; title: string } | undefined;

  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  if (!task.is_subtask) {
    return NextResponse.json(
      { error: 'skip-planning is only valid for subtasks. For mission planning, use /api/missions/[id]/start-planning.', code: 'not_a_subtask' },
      { status: 400 }
    );
  }
  if (task.status !== 'planning') {
    return NextResponse.json(
      { error: `Task is in status "${task.status}", not "planning". Nothing to skip.`, code: 'not_planning' },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE tasks SET status = 'inbox', updated_at = ? WHERE id = ?`).run(now, id);

  const refreshed = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (refreshed) broadcast({ type: 'task_updated', payload: refreshed });

  if (task.convoy_id) {
    dispatchReadyConvoySubtasks(task.convoy_id).catch(err =>
      console.error('[skip-planning] auto-drain failed:', err)
    );
  }

  return NextResponse.json({ ok: true, task_id: id, new_status: 'inbox' });
}
