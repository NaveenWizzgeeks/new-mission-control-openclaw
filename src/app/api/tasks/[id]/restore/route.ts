import { NextRequest, NextResponse } from 'next/server';
import { getDb, queryOne } from '@/lib/db';
import { broadcast } from '@/lib/events';

export const dynamic = 'force-dynamic';

interface TaskRow {
  id: string;
  status: string;
  convoy_id: string | null;
  rejected_at: string | null;
}

/**
 * Phase 13S.1: restore a previously-rejected task back to inbox.
 *
 * Body (optional): { status?: 'inbox' | 'planner_proposed' }
 *   - default 'inbox' so it joins the active queue
 *   - pass 'planner_proposed' to put it back in the Proposed column for re-decision
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let target: 'inbox' | 'planner_proposed' = 'inbox';
  try {
    const body = await request.json();
    if (body?.status === 'planner_proposed') target = 'planner_proposed';
  } catch { /* default */ }

  const task = queryOne<TaskRow>(
    `SELECT id, status, convoy_id, rejected_at FROM tasks WHERE id = ?`,
    [id],
  );
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  if (!task.rejected_at) {
    return NextResponse.json({ error: 'Task is not rejected', code: 'not_rejected' }, { status: 400 });
  }

  const now = new Date().toISOString();
  getDb().prepare(`UPDATE tasks SET rejected_at = NULL, status = ?, updated_at = ? WHERE id = ?`)
    .run(target, now, id);

  const refreshed = queryOne<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, [id]);
  if (refreshed) broadcast({ type: 'task_updated', payload: refreshed as unknown as Record<string, unknown> });

  if (task.convoy_id) {
    // Phase 13S.6: recompute counters inline + broadcast convoy_progress
    // immediately so the badge updates without waiting for hot-reload.
    try {
      const db = getDb();
      const counts = db.prepare(`
        SELECT
          SUM(CASE WHEN t.rejected_at IS NULL AND t.status != 'planner_proposed' THEN 1 ELSE 0 END) as total,
          SUM(CASE WHEN t.status = 'done' AND t.rejected_at IS NULL THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN t.status = 'planner_proposed' AND t.rejected_at IS NULL THEN 1 ELSE 0 END) as proposed
        FROM convoy_subtasks cs JOIN tasks t ON cs.task_id = t.id
        WHERE cs.convoy_id = ?
      `).get(task.convoy_id) as { total: number; completed: number; proposed: number };

      db.prepare(`
        UPDATE convoys
        SET total_subtasks = ?, completed_subtasks = ?, proposed_tasks_count = ?, updated_at = ?
        WHERE id = ?
      `).run(counts.total ?? 0, counts.completed ?? 0, counts.proposed ?? 0, now, task.convoy_id);

      const updatedConvoy = db.prepare(`SELECT * FROM convoys WHERE id = ?`).get(task.convoy_id);
      if (updatedConvoy) broadcast({ type: 'convoy_progress', payload: updatedConvoy as Record<string, unknown> });

      const { updateConvoyProgress, dispatchReadyConvoySubtasks } = await import('@/lib/convoy');
      updateConvoyProgress(task.convoy_id);
      if (target === 'inbox') {
        dispatchReadyConvoySubtasks(task.convoy_id).catch(err =>
          console.error('[restore] auto-drain failed:', err)
        );
      }
    } catch (err) {
      console.error('[restore] convoy progress update failed:', err);
    }
  }

  return NextResponse.json({ ok: true, action: 'restored', new_status: target });
}
