/**
 * Auto-promote subsystem
 *
 * Agents are dispatched with a two-step protocol:
 *   1. POST /api/tasks/[id]/activities  (activity_type='completed')
 *   2. PATCH /api/tasks/[id]            ({status: nextStatus})
 *
 * LLM-driven agents reliably do step 1 but frequently forget step 2,
 * leaving tasks stuck in their stage status. The watchdog then flags
 * stalled→stuck→zombie and nudge-redispatches — wasting tokens on work
 * that's already done.
 *
 * This module closes the gap: when a 'completed' activity is logged we
 * schedule a delayed auto-promote that re-runs the missing PATCH on the
 * agent's behalf. The delay lets a well-behaved agent's own PATCH win the
 * race so we don't double-promote in the happy path.
 */
import { queryOne, run } from '@/lib/db';
import { getMissionControlUrl } from '@/lib/config';
import { getTaskWorkflow } from '@/lib/workflow-engine';
import type { WorkflowTemplate } from '@/lib/types';

interface TaskRow {
  id: string;
  status: string;
  status_reason: string | null;
}

/**
 * Compute the workflow status that follows a successful completion at the
 * task's current status. Returns null when there's no next stage (already
 * terminal / unknown status).
 */
export function nextStatusAfterCompletion(
  currentStatus: string,
  workflow: WorkflowTemplate,
): string | null {
  let stageIdx = workflow.stages.findIndex(s => s.status === currentStatus);
  // 'assigned' / 'inbox' aren't workflow statuses — treat them as the build
  // stage because that's the only role-bearing stage that runs from
  // 'assigned' status before being promoted to 'in_progress'/'testing'.
  if (stageIdx < 0 && (currentStatus === 'assigned' || currentStatus === 'inbox')) {
    stageIdx = workflow.stages.findIndex(s => s.role === 'builder');
  }
  if (stageIdx < 0) return null;
  const next = workflow.stages[stageIdx + 1];
  return next?.status ?? null;
}

/**
 * Promote a task one stage forward by calling the public PATCH endpoint.
 * Designed to be called when an agent logs a `completed` activity but
 * forgets the follow-up status PATCH.
 *
 * Pre-checks make this safe to call speculatively:
 * - if the status moved between activity-log and now (the agent's own PATCH
 *   won the race), this is a no-op
 * - already-done tasks are skipped
 * - missing workflow / no next stage skips
 *
 * Stale watchdog escalation flags ("Escalated after repeated failures...")
 * are cleared when promoting to 'done', otherwise the evidence gate in
 * PATCH would block the very transition the agent has just earned.
 *
 * Never throws. Logs failures and gives up.
 */
export async function autoPromoteOnCompletion(
  taskId: string,
  expectedStatus: string,
): Promise<void> {
  try {
    const task = queryOne<TaskRow>(
      'SELECT id, status, status_reason FROM tasks WHERE id = ?',
      [taskId],
    );
    if (!task) return;
    // Status moved — agent's own PATCH won the race, or watchdog already
    // reconciled. Either way, nothing to do.
    if (task.status !== expectedStatus) return;
    if (task.status === 'done') return;

    const workflow = getTaskWorkflow(taskId);
    if (!workflow) return;

    const nextStatus = nextStatusAfterCompletion(task.status, workflow);
    if (!nextStatus || nextStatus === task.status) return;

    // taskCanBeDone() blocks the 'done' transition when status_reason
    // contains "fail". Watchdog escalations stamp messages like
    // "Escalated after repeated failures in testing" which then keep the
    // task stuck even after the verifier reports a clean pass. Clear the
    // stale flag so the gate sees the post-completion state truthfully.
    if (
      nextStatus === 'done' &&
      task.status_reason &&
      /escalat|fail/i.test(task.status_reason)
    ) {
      run(
        "UPDATE tasks SET status_reason = NULL, updated_at = datetime('now') WHERE id = ?",
        [taskId],
      );
    }

    const url = `${getMissionControlUrl()}/api/tasks/${taskId}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.MC_API_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.MC_API_TOKEN}`;
    }

    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: nextStatus }),
      signal: AbortSignal.timeout(30_000),
    });

    if (res.ok) {
      console.log(
        `[AutoPromote] Task ${taskId} promoted ${expectedStatus} → ${nextStatus} (agent forgot to PATCH)`,
      );
    } else {
      const text = await res.text();
      console.warn(
        `[AutoPromote] Task ${taskId} promotion ${expectedStatus} → ${nextStatus} failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }
  } catch (err) {
    console.error(`[AutoPromote] Error for task ${taskId}:`, err);
  }
}

/**
 * Schedule a deferred auto-promote so the agent's own PATCH (if it remembers)
 * wins the race. AUTO_PROMOTE_DELAY_MS is short enough that downstream stages
 * pick up quickly when the agent forgets, but long enough to dedupe the happy
 * path against the agent's intentional PATCH.
 */
const AUTO_PROMOTE_DELAY_MS = 5_000;

export function scheduleAutoPromote(taskId: string, expectedStatus: string): void {
  setTimeout(() => {
    void autoPromoteOnCompletion(taskId, expectedStatus);
  }, AUTO_PROMOTE_DELAY_MS);
}
