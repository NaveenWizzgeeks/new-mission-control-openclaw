import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run, transaction } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { notifyLearner } from '@/lib/learner';
import { getMissionControlUrl } from '@/lib/config';
import { pickDynamicAgent } from '@/lib/task-governance';
import type { Convoy, ConvoySubtask, Task, ConvoyStatus, DecompositionStrategy } from '@/lib/types';

interface CreateSubtaskInput {
  title: string;
  description?: string;
  agent_id?: string;
  depends_on?: string[];
}

interface CreateConvoyInput {
  parentTaskId: string;
  name: string;
  strategy: DecompositionStrategy;
  decompositionSpec?: string;
  subtasks?: CreateSubtaskInput[];
}

/**
 * Create a convoy from a parent task with optional sub-tasks.
 */
export function createConvoy(input: CreateConvoyInput): Convoy {
  const { parentTaskId, name, strategy, decompositionSpec, subtasks = [] } = input;

  return transaction(() => {
    const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [parentTaskId]);
    if (!task) throw new Error(`Task ${parentTaskId} not found`);
    if (task.is_subtask) throw new Error('Cannot create a convoy from a sub-task');

    // Check no convoy already exists for this task
    const existing = queryOne<{ id: string }>('SELECT id FROM convoys WHERE parent_task_id = ?', [parentTaskId]);
    if (existing) throw new Error(`Convoy already exists for task ${parentTaskId}`);

    const convoyId = uuidv4();
    const now = new Date().toISOString();

    run(
      `INSERT INTO convoys (id, parent_task_id, name, status, decomposition_strategy, decomposition_spec, total_subtasks, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      [convoyId, parentTaskId, name, strategy, decompositionSpec || null, subtasks.length, now, now]
    );

    // Move parent task to convoy_active
    run(
      `UPDATE tasks SET status = 'convoy_active', updated_at = ? WHERE id = ?`,
      [now, parentTaskId]
    );

    // Create sub-tasks
    for (let i = 0; i < subtasks.length; i++) {
      const sub = subtasks[i];
      const subtaskId = uuidv4();
      const convoySubtaskId = uuidv4();

      // Create the task entry
      run(
        `INSERT INTO tasks (id, title, description, status, priority, assigned_agent_id, workspace_id, business_id, workflow_template_id, convoy_id, is_subtask, created_at, updated_at)
         VALUES (?, ?, ?, 'inbox', ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [subtaskId, sub.title, sub.description || null, task.priority, sub.agent_id || null, task.workspace_id, task.business_id, task.workflow_template_id || null, convoyId, now, now]
      );

      // Create the convoy_subtasks relationship
      run(
        `INSERT INTO convoy_subtasks (id, convoy_id, task_id, sort_order, depends_on, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [convoySubtaskId, convoyId, subtaskId, i, sub.depends_on ? JSON.stringify(sub.depends_on) : null, now]
      );
    }

    const convoy = queryOne<Convoy>('SELECT * FROM convoys WHERE id = ?', [convoyId])!;

    // Broadcast
    const updatedParent = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [parentTaskId]);
    if (updatedParent) broadcast({ type: 'task_updated', payload: updatedParent });
    broadcast({ type: 'convoy_created', payload: convoy });

    // Log event
    run(
      `INSERT INTO events (id, type, task_id, message, created_at) VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), 'task_status_changed', parentTaskId, `Convoy "${name}" created with ${subtasks.length} sub-tasks`, now]
    );

    return convoy;
  });
}

/**
 * Get convoy details for a parent task, with subtasks joined.
 */
export function getConvoy(parentTaskId: string): (Convoy & { subtasks: (ConvoySubtask & { task: Task })[] }) | null {
  const convoy = queryOne<Convoy>(
    'SELECT * FROM convoys WHERE parent_task_id = ?',
    [parentTaskId]
  );
  if (!convoy) return null;

  const subtaskRows = queryAll<ConvoySubtask & { task_title: string; task_status: string; task_assigned_agent_id: string | null }>(
    `SELECT cs.*, t.title as task_title, t.status as task_status, t.assigned_agent_id as task_assigned_agent_id
     FROM convoy_subtasks cs
     JOIN tasks t ON cs.task_id = t.id
     WHERE cs.convoy_id = ?
     ORDER BY cs.sort_order`,
    [convoy.id]
  );

  const subtasks = subtaskRows.map(row => ({
    ...row,
    depends_on: row.depends_on ? JSON.parse(row.depends_on as unknown as string) : undefined,
    task: {
      id: row.task_id,
      title: row.task_title,
      status: row.task_status,
      assigned_agent_id: row.task_assigned_agent_id,
    } as Task,
  }));

  return { ...convoy, subtasks };
}

/**
 * Recalculate convoy progress counters from actual sub-task statuses.
 */
export function updateConvoyProgress(convoyId: string): void {
  const completed = queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM convoy_subtasks cs JOIN tasks t ON cs.task_id = t.id
     WHERE cs.convoy_id = ? AND t.status = 'done'`,
    [convoyId]
  )?.cnt || 0;

  const failed = queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM convoy_subtasks cs JOIN tasks t ON cs.task_id = t.id
     WHERE cs.convoy_id = ? AND t.status_reason IS NOT NULL AND t.status = 'in_progress'`,
    [convoyId]
  )?.cnt || 0;

  const now = new Date().toISOString();
  run(
    `UPDATE convoys SET completed_subtasks = ?, failed_subtasks = ?, updated_at = ? WHERE id = ?`,
    [completed, failed, now, convoyId]
  );

  const convoy = queryOne<Convoy>('SELECT * FROM convoys WHERE id = ?', [convoyId]);
  if (convoy) {
    broadcast({ type: 'convoy_progress', payload: convoy });
  }
}

/**
 * Check if a convoy is complete (all sub-tasks done) and transition accordingly.
 */
export function checkConvoyCompletion(convoyId: string): boolean {
  const convoy = queryOne<Convoy>('SELECT * FROM convoys WHERE id = ?', [convoyId]);
  if (!convoy || convoy.status !== 'active') return false;

  const total = convoy.total_subtasks;
  const completed = queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM convoy_subtasks cs JOIN tasks t ON cs.task_id = t.id
     WHERE cs.convoy_id = ? AND t.status = 'done'`,
    [convoyId]
  )?.cnt || 0;

  if (completed >= total && total > 0) {
    const now = new Date().toISOString();

    // Move convoy to completing → done
    run(
      `UPDATE convoys SET status = 'done', completed_subtasks = ?, updated_at = ? WHERE id = ?`,
      [completed, now, convoyId]
    );

    // Move parent task to review
    run(
      `UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`,
      [now, convoy.parent_task_id]
    );

    const updatedParent = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [convoy.parent_task_id]);
    if (updatedParent) broadcast({ type: 'task_updated', payload: updatedParent });

    const updatedConvoy = queryOne<Convoy>('SELECT * FROM convoys WHERE id = ?', [convoyId]);
    if (updatedConvoy) broadcast({ type: 'convoy_completed', payload: updatedConvoy });

    run(
      `INSERT INTO events (id, type, task_id, message, created_at) VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), 'task_status_changed', convoy.parent_task_id, `Convoy complete — all ${total} sub-tasks done`, now]
    );

    // Notify learner about convoy completion
    notifyLearner(convoy.parent_task_id, {
      previousStatus: 'convoy_active',
      newStatus: 'review',
      passed: true,
      context: `Convoy completed successfully with ${total} sub-tasks.`,
    }).catch(err => console.error('[Learner] convoy completion notification failed:', err));

    return true;
  }

  // Check failure threshold (more than half failed)
  const failed = queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM convoy_subtasks cs JOIN tasks t ON cs.task_id = t.id
     WHERE cs.convoy_id = ? AND t.status_reason IS NOT NULL`,
    [convoyId]
  )?.cnt || 0;

  if (failed > total / 2) {
    const now = new Date().toISOString();
    run(`UPDATE convoys SET status = 'failed', failed_subtasks = ?, updated_at = ? WHERE id = ?`, [failed, now, convoyId]);
    run(`UPDATE tasks SET status = 'review', status_reason = 'Convoy failed: too many sub-task failures', updated_at = ? WHERE id = ?`, [now, convoy.parent_task_id]);

    notifyLearner(convoy.parent_task_id, {
      previousStatus: 'convoy_active',
      newStatus: 'review',
      passed: false,
      failReason: `Convoy failed: ${failed} of ${total} sub-tasks failed (threshold exceeded).`,
    }).catch(err => console.error('[Learner] convoy failure notification failed:', err));
  }

  return false;
}

/**
 * Find sub-tasks that are ready to dispatch (in inbox, all dependencies done).
 */
export function getDispatchableSubtasks(convoyId: string): ConvoySubtask[] {
  const subtasks = queryAll<ConvoySubtask & { task_status: string }>(
    `SELECT cs.*, t.status as task_status
     FROM convoy_subtasks cs
     JOIN tasks t ON cs.task_id = t.id
     WHERE cs.convoy_id = ? AND t.status = 'inbox'
     ORDER BY cs.sort_order`,
    [convoyId]
  );

  // Get all done task IDs in this convoy for dependency checking
  const doneTaskIds = new Set(
    queryAll<{ task_id: string }>(
      `SELECT cs.task_id FROM convoy_subtasks cs JOIN tasks t ON cs.task_id = t.id
       WHERE cs.convoy_id = ? AND t.status = 'done'`,
      [convoyId]
    ).map(r => r.task_id)
  );

  return subtasks.filter(st => {
    const deps = st.depends_on ? JSON.parse(st.depends_on as unknown as string) as string[] : [];
    return deps.every(depId => doneTaskIds.has(depId));
  });
}

/**
 * Dispatch all ready convoy subtasks (DAG-aware, MAX_PARALLEL=5).
 * Pure in-process call — no HTTP self-call. Callable from any server-side context.
 * All sync DB writes happen before any awaits, making concurrent calls safe.
 */
export async function dispatchReadyConvoySubtasks(convoyId: string): Promise<{
  dispatched: number;
  total: number;
  results: Array<{ taskId: string; success: boolean; error?: string }>;
}> {
  const convoy = queryOne<Convoy>('SELECT * FROM convoys WHERE id = ?', [convoyId]);
  if (!convoy || convoy.status !== 'active') {
    return { dispatched: 0, total: 0, results: [] };
  }

  const allDispatchable = getDispatchableSubtasks(convoyId);
  if (allDispatchable.length === 0) {
    return { dispatched: 0, total: 0, results: [] };
  }

  const MAX_PARALLEL = 5;
  const currentlyActive = queryAll<{ id: string }>(
    `SELECT t.id FROM convoy_subtasks cs JOIN tasks t ON cs.task_id = t.id
     WHERE cs.convoy_id = ? AND t.status IN ('assigned', 'in_progress', 'testing', 'verification')`,
    [convoyId]
  ).length;
  const slots = Math.max(0, MAX_PARALLEL - currentlyActive);
  const toDispatch = allDispatchable.slice(0, slots);

  if (toDispatch.length === 0) {
    return { dispatched: 0, total: 0, results: [] };
  }

  // Auto-assign agents and mark as assigned — all sync writes before any awaits
  const readyTaskIds: string[] = [];
  for (const subtask of toDispatch) {
    const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [subtask.task_id]);
    if (!task) continue;

    let agentId = task.assigned_agent_id;
    if (!agentId) {
      const picked = pickDynamicAgent(subtask.task_id, 'builder');
      if (picked) {
        agentId = picked.id;
        run("UPDATE tasks SET assigned_agent_id = ?, updated_at = datetime('now') WHERE id = ?", [agentId, subtask.task_id]);
      }
    }

    if (!agentId) continue;

    run("UPDATE tasks SET status = 'assigned', updated_at = datetime('now') WHERE id = ?", [subtask.task_id]);
    readyTaskIds.push(subtask.task_id);
  }

  if (readyTaskIds.length === 0) {
    return { dispatched: 0, total: toDispatch.length, results: [] };
  }

  // Async per-subtask dispatch via the existing dispatch route
  const missionControlUrl = getMissionControlUrl();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.MC_API_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.MC_API_TOKEN}`;
  }

  const results: Array<{ taskId: string; success: boolean; error?: string }> = [];
  for (const taskId of readyTaskIds) {
    try {
      const res = await fetch(`${missionControlUrl}/api/tasks/${taskId}/dispatch`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        results.push({ taskId, success: true });
      } else {
        const errorText = await res.text();
        results.push({ taskId, success: false, error: errorText });
      }
    } catch (err) {
      results.push({ taskId, success: false, error: (err as Error).message });
    }
  }

  const dispatched = results.filter(r => r.success).length;
  return { dispatched, total: toDispatch.length, results };
}

/**
 * Add subtask(s) to an existing convoy.
 */
export function addSubtasks(convoyId: string, subtasks: CreateSubtaskInput[]): ConvoySubtask[] {
  const convoy = queryOne<Convoy>('SELECT * FROM convoys WHERE id = ?', [convoyId]);
  if (!convoy) throw new Error(`Convoy ${convoyId} not found`);

  const parentTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [convoy.parent_task_id]);
  if (!parentTask) throw new Error('Parent task not found');

  const maxOrder = queryOne<{ max_order: number }>(
    'SELECT MAX(sort_order) as max_order FROM convoy_subtasks WHERE convoy_id = ?',
    [convoyId]
  )?.max_order || 0;

  const created: ConvoySubtask[] = [];
  const now = new Date().toISOString();

  return transaction(() => {
    for (let i = 0; i < subtasks.length; i++) {
      const sub = subtasks[i];
      const subtaskId = uuidv4();
      const convoySubtaskId = uuidv4();

      run(
        `INSERT INTO tasks (id, title, description, status, priority, assigned_agent_id, workspace_id, business_id, workflow_template_id, convoy_id, is_subtask, created_at, updated_at)
         VALUES (?, ?, ?, 'inbox', ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [subtaskId, sub.title, sub.description || null, parentTask.priority, sub.agent_id || null, parentTask.workspace_id, parentTask.business_id, parentTask.workflow_template_id || null, convoyId, now, now]
      );

      run(
        `INSERT INTO convoy_subtasks (id, convoy_id, task_id, sort_order, depends_on, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [convoySubtaskId, convoyId, subtaskId, maxOrder + i + 1, sub.depends_on ? JSON.stringify(sub.depends_on) : null, now]
      );

      created.push({ id: convoySubtaskId, convoy_id: convoyId, task_id: subtaskId, sort_order: maxOrder + i + 1, depends_on: sub.depends_on, created_at: now });
    }

    // Update total count
    run(
      `UPDATE convoys SET total_subtasks = total_subtasks + ?, updated_at = ? WHERE id = ?`,
      [subtasks.length, now, convoyId]
    );

    return created;
  });
}

/**
 * Update convoy status (pause, resume, cancel).
 */
export function updateConvoyStatus(convoyId: string, status: ConvoyStatus): Convoy {
  const now = new Date().toISOString();
  run(`UPDATE convoys SET status = ?, updated_at = ? WHERE id = ?`, [status, now, convoyId]);
  const convoy = queryOne<Convoy>('SELECT * FROM convoys WHERE id = ?', [convoyId])!;
  return convoy;
}

/**
 * Delete a convoy and all its sub-tasks.
 */
export function deleteConvoy(convoyId: string): void {
  const convoy = queryOne<Convoy>('SELECT * FROM convoys WHERE id = ?', [convoyId]);
  if (!convoy) throw new Error(`Convoy ${convoyId} not found`);

  transaction(() => {
    // Delete sub-task entries (cascade will handle convoy_subtasks)
    const subtaskIds = queryAll<{ task_id: string }>(
      'SELECT task_id FROM convoy_subtasks WHERE convoy_id = ?',
      [convoyId]
    );
    for (const { task_id } of subtaskIds) {
      run('DELETE FROM tasks WHERE id = ?', [task_id]);
    }

    // Delete convoy
    run('DELETE FROM convoys WHERE id = ?', [convoyId]);

    // Reset parent task back to inbox
    const now = new Date().toISOString();
    run(
      `UPDATE tasks SET status = 'inbox', updated_at = ? WHERE id = ?`,
      [now, convoy.parent_task_id]
    );

    const updatedParent = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [convoy.parent_task_id]);
    if (updatedParent) broadcast({ type: 'task_updated', payload: updatedParent });
  });
}
