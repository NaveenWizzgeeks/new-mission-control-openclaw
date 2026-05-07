import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDb, queryOne } from '@/lib/db';
import { broadcast } from '@/lib/events';

export const dynamic = 'force-dynamic';

interface ConvoyRow {
  id: string;
  parent_task_id: string;
  total_subtasks: number;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  workspace_id: string;
  is_subtask: number;
  convoy_id: string | null;
}

/**
 * Phase 13P.1: adopt a standalone task into this mission as a subtask.
 *
 * Body: { task_id: string }
 *
 * Pre-conditions enforced:
 *   - Mission (convoy) exists
 *   - Task exists and is NOT already a subtask of any convoy
 *   - Task is in the same workspace as the mission's parent task
 *
 * Effect:
 *   - Sets tasks.convoy_id + is_subtask=1
 *   - Inserts convoy_subtasks row at next sort_order
 *   - Recomputes convoys.total_subtasks/completed_subtasks
 *   - Fires auto-drain so the adopted task can dispatch if dependencies are met
 *   - Broadcasts task_updated + convoy_progress
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: missionId } = await params;

  let body: { task_id?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'validation_failed' }, { status: 400 });
  }
  const taskId = body.task_id?.trim();
  if (!taskId) {
    return NextResponse.json({ error: 'task_id is required', code: 'validation_failed' }, { status: 400 });
  }

  const db = getDb();
  const convoy = queryOne<ConvoyRow>(
    `SELECT id, parent_task_id, total_subtasks FROM convoys WHERE id = ?`,
    [missionId],
  );
  if (!convoy) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

  const task = queryOne<TaskRow>(
    `SELECT id, title, status, workspace_id, is_subtask, convoy_id FROM tasks WHERE id = ?`,
    [taskId],
  );
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  if (task.id === convoy.parent_task_id) {
    return NextResponse.json({ error: 'Cannot adopt the mission\'s own parent task', code: 'parent_loop' }, { status: 400 });
  }
  if (task.convoy_id) {
    return NextResponse.json(
      { error: `Task is already a subtask of mission ${task.convoy_id}. Detach first.`, code: 'already_in_mission' },
      { status: 409 }
    );
  }

  const parent = queryOne<{ workspace_id: string }>(
    `SELECT workspace_id FROM tasks WHERE id = ?`,
    [convoy.parent_task_id],
  );
  if (parent && parent.workspace_id !== task.workspace_id) {
    return NextResponse.json(
      { error: `Task is in workspace ${task.workspace_id}; mission is in ${parent.workspace_id}. Cross-workspace adoption is not supported.`, code: 'workspace_mismatch' },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const nextOrder = (queryOne<{ n: number }>(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM convoy_subtasks WHERE convoy_id = ?`,
    [missionId],
  )?.n) ?? 1;

  const tx = db.transaction(() => {
    db.prepare(`UPDATE tasks SET convoy_id = ?, is_subtask = 1, updated_at = ? WHERE id = ?`)
      .run(missionId, now, taskId);
    db.prepare(`
      INSERT INTO convoy_subtasks (id, convoy_id, task_id, sort_order, depends_on, created_at)
      VALUES (?, ?, ?, ?, NULL, ?)
    `).run(uuidv4(), missionId, taskId, nextOrder, now);
    // Recompute counters from truth.
    db.prepare(`
      UPDATE convoys SET
        total_subtasks = (SELECT COUNT(*) FROM convoy_subtasks WHERE convoy_id = convoys.id),
        completed_subtasks = (
          SELECT COUNT(*) FROM convoy_subtasks cs JOIN tasks t ON t.id = cs.task_id
          WHERE cs.convoy_id = convoys.id AND t.status = 'done'
        ),
        updated_at = ?
      WHERE id = ?
    `).run(now, missionId);
  });
  tx();

  const refreshed = queryOne<Record<string, unknown>>(`SELECT * FROM tasks WHERE id = ?`, [taskId]);
  if (refreshed) broadcast({ type: 'task_updated', payload: refreshed });
  broadcast({ type: 'convoy_progress', payload: { convoy_id: missionId } as Record<string, unknown> });

  // Fire-and-forget auto-drain: if the adopted task is in inbox with no
  // dependencies it'll start immediately.
  void (async () => {
    try {
      const { dispatchReadyConvoySubtasks } = await import('@/lib/convoy');
      await dispatchReadyConvoySubtasks(missionId);
    } catch (err) {
      console.error('[adopt-task] auto-drain failed:', err);
    }
  })();

  return NextResponse.json({
    ok: true,
    mission_id: missionId,
    task_id: taskId,
    sort_order: nextOrder,
  }, { status: 201 });
}
