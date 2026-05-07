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
 * Phase 13S.1: reject a task without deleting it.
 *
 * Sets rejected_at = now. The row stays in the DB so the user can restore
 * it later. Convoy counters / workspace counters / auto-propose all skip
 * tasks where rejected_at IS NOT NULL.
 *
 * Typical use: dismiss a planner_proposed suggestion without removing it
 * from history. The Rejected kanban column shows it; the user can restore
 * via /api/tasks/[id]/restore.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const task = queryOne<TaskRow>(
    `SELECT id, status, convoy_id, rejected_at FROM tasks WHERE id = ?`,
    [id],
  );
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  if (task.rejected_at) {
    return NextResponse.json({ ok: true, action: 'already_rejected', rejected_at: task.rejected_at });
  }

  const now = new Date().toISOString();
  getDb().prepare(`UPDATE tasks SET rejected_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);

  const refreshed = queryOne<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, [id]);
  if (refreshed) broadcast({ type: 'task_updated', payload: refreshed as unknown as Record<string, unknown> });

  if (task.convoy_id) {
    // Phase 13S.6: recompute counters inline + broadcast convoy_progress
    // immediately so the badge updates without waiting for hot-reload of
    // updateConvoyProgress to pick up. Belt-and-braces: also call
    // updateConvoyProgress for any side-effects we don't duplicate here.
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

      const { updateConvoyProgress } = await import('@/lib/convoy');
      updateConvoyProgress(task.convoy_id);
    } catch (err) {
      console.error('[reject] convoy progress update failed:', err);
    }
  }

  return NextResponse.json({ ok: true, action: 'rejected', rejected_at: now });
}
