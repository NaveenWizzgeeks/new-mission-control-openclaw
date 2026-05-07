import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { getMissionControlUrl } from '@/lib/config';
import { buildCheckpointContext } from '@/lib/checkpoint';
import { autoPromoteOnCompletion } from '@/lib/auto-promote';
import type { Agent, AgentHealth, AgentHealthState, Task } from '@/lib/types';

const STALL_THRESHOLD_MINUTES = 5;
const STUCK_THRESHOLD_MINUTES = 15;
const AUTO_NUDGE_AFTER_STALLS = 3;
// If a 'completed' activity landed within this window, we treat the task as
// "agent finished but forgot to PATCH" and reconcile via auto-promote rather
// than nudging — preventing the most expensive failure mode (re-dispatching
// work that's actually done).
const RECENT_COMPLETION_WINDOW_MIN = 30;

/**
 * Check health state for a single agent.
 */
export function checkAgentHealth(agentId: string): AgentHealthState {
  const agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [agentId]);
  if (!agent) return 'offline';
  if (agent.status === 'offline') return 'offline';

  // Find active task
  const activeTask = queryOne<Task>(
    `SELECT * FROM tasks WHERE assigned_agent_id = ? AND status IN ('assigned', 'in_progress', 'testing', 'verification') LIMIT 1`,
    [agentId]
  );

  if (!activeTask) return 'idle';

  // Check if OpenClaw session is still alive
  const session = queryOne<{ status: string }>(
    `SELECT status FROM openclaw_sessions WHERE agent_id = ? AND task_id = ? AND status = 'active' LIMIT 1`,
    [agentId, activeTask.id]
  );

  if (!session) {
    // Check for any active session (task might not be linked yet)
    const anySession = queryOne<{ status: string }>(
      `SELECT status FROM openclaw_sessions WHERE agent_id = ? AND status = 'active' LIMIT 1`,
      [agentId]
    );
    if (!anySession) return 'zombie';
  }

  // Check last REAL activity (exclude health check logs — they reset the clock and prevent stuck detection)
  const lastActivity = queryOne<{ created_at: string }>(
    `SELECT created_at FROM task_activities WHERE task_id = ? AND message NOT LIKE 'Agent health:%' ORDER BY created_at DESC LIMIT 1`,
    [activeTask.id]
  );

  if (lastActivity) {
    const minutesSince = (Date.now() - new Date(lastActivity.created_at).getTime()) / 60000;
    if (minutesSince > STUCK_THRESHOLD_MINUTES) return 'stuck';
    if (minutesSince > STALL_THRESHOLD_MINUTES) return 'stalled';
  } else {
    // No real activity at all — check how long the task has been in progress
    const taskAge = (Date.now() - new Date(activeTask.updated_at).getTime()) / 60000;
    if (taskAge > STUCK_THRESHOLD_MINUTES) return 'stuck';
    if (taskAge > STALL_THRESHOLD_MINUTES) return 'stalled';
  }

  return 'working';
}

/**
 * Run a full health check cycle across all agents with active tasks.
 */
export async function runHealthCheckCycle(): Promise<AgentHealth[]> {
  const activeAgents = queryAll<{ id: string }>(
    `SELECT DISTINCT assigned_agent_id as id FROM tasks WHERE status IN ('assigned', 'in_progress', 'testing', 'verification') AND assigned_agent_id IS NOT NULL`
  );

  // Also check agents that are in 'working' status but may have no tasks
  const workingAgents = queryAll<{ id: string }>(
    `SELECT id FROM agents WHERE status = 'working'`
  );

  const allAgentIds = Array.from(new Set([...activeAgents.map(a => a.id), ...workingAgents.map(a => a.id)]));
  const results: AgentHealth[] = [];
  const now = new Date().toISOString();

  for (const agentId of allAgentIds) {
    const healthState = checkAgentHealth(agentId);

    // Find current task for this agent
    const activeTask = queryOne<Task>(
      `SELECT * FROM tasks WHERE assigned_agent_id = ? AND status IN ('assigned', 'in_progress', 'testing', 'verification') LIMIT 1`,
      [agentId]
    );

    // Upsert health record
    const existing = queryOne<AgentHealth>(
      'SELECT * FROM agent_health WHERE agent_id = ?',
      [agentId]
    );

    const previousState = existing?.health_state;

    if (existing) {
      const consecutiveStalls = healthState === 'stalled' || healthState === 'stuck'
        ? (existing.consecutive_stall_checks || 0) + 1
        : 0;

      run(
        `UPDATE agent_health SET health_state = ?, task_id = ?, last_activity_at = ?, consecutive_stall_checks = ?, updated_at = ?
         WHERE agent_id = ?`,
        [healthState, activeTask?.id || null, now, consecutiveStalls, now, agentId]
      );
    } else {
      const healthId = uuidv4();
      run(
        `INSERT INTO agent_health (id, agent_id, task_id, health_state, last_activity_at, consecutive_stall_checks, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        [healthId, agentId, activeTask?.id || null, healthState, now, now]
      );
    }

    // Broadcast if health state changed
    if (previousState && previousState !== healthState) {
      const healthRecord = queryOne<AgentHealth>('SELECT * FROM agent_health WHERE agent_id = ?', [agentId]);
      if (healthRecord) {
        broadcast({ type: 'agent_health_changed', payload: healthRecord });
      }
    }

    // Log warnings for degraded states — but only on transition. The watchdog
    // runs every 2 min; without this guard, a single stuck task spams the
    // activity log with "Agent health: zombie" rows that drown out real signal.
    if (
      activeTask &&
      (healthState === 'stalled' || healthState === 'stuck' || healthState === 'zombie') &&
      previousState !== healthState
    ) {
      run(
        `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
         VALUES (?, ?, ?, 'status_changed', ?, ?)`,
        [uuidv4(), activeTask.id, agentId, `Agent health: ${healthState}`, now]
      );
    }

    // Auto-nudge after consecutive stall checks — but reconcile first.
    const updatedHealth = queryOne<AgentHealth>('SELECT * FROM agent_health WHERE agent_id = ?', [agentId]);
    if (updatedHealth) {
      results.push(updatedHealth);
      if (updatedHealth.consecutive_stall_checks >= AUTO_NUDGE_AFTER_STALLS && healthState === 'stuck') {
        // Reconcile then nudge. Order matters: a recent 'completed' activity
        // means the agent finished but skipped the PATCH — re-dispatching
        // would burn tokens on done work. Sync-from-gateway catches the
        // case where the gateway session ended cleanly without us hearing
        // about it. Only after both reconciliation paths fail do we nudge.
        void reconcileBeforeNudge(agentId, activeTask?.id).then(reconciled => {
          if (reconciled) {
            console.log(`[Health] Skipped nudge for ${agentId} — task reconciled instead`);
            return;
          }
          nudgeAgent(agentId).catch(err =>
            console.error(`[Health] Auto-nudge failed for agent ${agentId}:`, err)
          );
        }).catch(err => {
          console.error(`[Health] reconcile-then-nudge failed for ${agentId}:`, err);
          nudgeAgent(agentId).catch(e =>
            console.error(`[Health] Auto-nudge fallback failed for agent ${agentId}:`, e)
          );
        });
      }
    }
  }

  // Sweep for orphaned assigned tasks — planning complete but never dispatched
  const ASSIGNED_STALE_MINUTES = 2;
  const orphanedTasks = queryAll<Task>(
    `SELECT * FROM tasks 
     WHERE status = 'assigned' 
       AND planning_complete = 1 
       AND (julianday('now') - julianday(updated_at)) * 1440 > ?`,
    [ASSIGNED_STALE_MINUTES]
  );

  for (const task of orphanedTasks) {
    console.log(`[Health] Orphaned assigned task detected: "${task.title}" (${task.id}) — stale for >${ASSIGNED_STALE_MINUTES}min, auto-dispatching`);
    
    const missionControlUrl = getMissionControlUrl();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.MC_API_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.MC_API_TOKEN}`;
    }

    try {
      const res = await fetch(`${missionControlUrl}/api/tasks/${task.id}/dispatch`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(30_000),
      });

      if (res.ok) {
        console.log(`[Health] Auto-dispatched orphaned task "${task.title}"`);
        run(
          `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
           VALUES (?, ?, ?, 'status_changed', 'Auto-dispatched by health sweeper (was stuck in assigned)', ?)`,
          [uuidv4(), task.id, task.assigned_agent_id, now]
        );
      } else {
        const errorText = await res.text();
        console.error(`[Health] Failed to auto-dispatch orphaned task "${task.title}": ${errorText}`);
        // Record the failure so it shows in the UI
        run(
          `UPDATE tasks SET planning_dispatch_error = ?, updated_at = ? WHERE id = ?`,
          [`Health sweeper dispatch failed: ${errorText.substring(0, 200)}`, now, task.id]
        );
      }
    } catch (err) {
      console.error(`[Health] Auto-dispatch error for orphaned task "${task.title}":`, (err as Error).message);
    }
  }

  // Also set idle agents
  const idleAgents = queryAll<{ id: string }>(
    `SELECT id FROM agents WHERE status = 'standby' AND id NOT IN (SELECT assigned_agent_id FROM tasks WHERE status IN ('assigned', 'in_progress', 'testing', 'verification') AND assigned_agent_id IS NOT NULL)`
  );
  for (const { id: agentId } of idleAgents) {
    const existing = queryOne<{ id: string }>('SELECT id FROM agent_health WHERE agent_id = ?', [agentId]);
    if (existing) {
      run(`UPDATE agent_health SET health_state = 'idle', task_id = NULL, consecutive_stall_checks = 0, updated_at = ? WHERE agent_id = ?`, [now, agentId]);
    } else {
      run(
        `INSERT INTO agent_health (id, agent_id, health_state, updated_at) VALUES (?, ?, 'idle', ?)`,
        [uuidv4(), agentId, now]
      );
    }
  }

  // Status hygiene + completion-mismatch sweep. Both run every cycle so the
  // dashboard converges on the truth even when the per-agent path missed.
  reconcileStaleWorkingAgents();
  await sweepCompletionMismatches();

  return results;
}

/**
 * Reconcile a single task without nudging. Returns true when the task ended
 * up in a state where re-dispatch would be wrong (already done / needs human
 * attention). Used both pre-nudge (per-agent loop) and from the periodic
 * sweeper that catches tasks the per-agent loop missed.
 *
 * Two paths:
 * 1. A 'completed' activity in the recent window means the agent finished
 *    work but skipped the PATCH. We let auto-promote run that PATCH on its
 *    behalf — same code as the activity-log self-heal, just invoked
 *    immediately rather than on a 5s scheduler.
 * 2. Otherwise ask the gateway whether the underlying session terminated.
 *    sync-from-gateway flips the task to 'done' on terminal-success and
 *    flags it for user attention on terminal-failure; in either case we
 *    suppress the nudge.
 */
async function reconcileTask(taskId: string): Promise<boolean> {
  // Path 1: agent finished but forgot the PATCH
  const recentCompletion = queryOne<{ created_at: string }>(
    `SELECT created_at FROM task_activities
     WHERE task_id = ? AND activity_type = 'completed'
     ORDER BY created_at DESC LIMIT 1`,
    [taskId],
  );

  if (recentCompletion) {
    const minsSince =
      (Date.now() - new Date(recentCompletion.created_at).getTime()) / 60000;
    if (minsSince <= RECENT_COMPLETION_WINDOW_MIN) {
      const before = queryOne<{ status: string }>(
        'SELECT status FROM tasks WHERE id = ?',
        [taskId],
      );
      if (before) {
        await autoPromoteOnCompletion(taskId, before.status);
        const after = queryOne<{ status: string }>(
          'SELECT status FROM tasks WHERE id = ?',
          [taskId],
        );
        if (after && after.status !== before.status) {
          console.log(
            `[Health] Reconciled ${taskId} via auto-promote (${before.status} → ${after.status})`,
          );
          return true;
        }
      }
    }
  }

  // Path 2: gateway session may have ended without us being told
  try {
    const url = `${getMissionControlUrl()}/api/tasks/${taskId}/sync-from-gateway`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.MC_API_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.MC_API_TOKEN}`;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { action?: string };
      // marked_done: gateway finished cleanly → task is done, skip nudge.
      // flagged_failed: gateway errored → user should pick re-dispatch
      // explicitly from the UI rather than us silently retrying and
      // burning tokens on a known-broken session.
      if (data.action === 'marked_done' || data.action === 'flagged_failed') {
        console.log(
          `[Health] Reconciled ${taskId} via sync-from-gateway (${data.action})`,
        );
        return true;
      }
    }
  } catch (err) {
    console.error(`[Health] reconcile sync-from-gateway failed for ${taskId}:`, err);
    // Fall through — we shouldn't get stuck because the gateway is briefly
    // unreachable.
  }

  return false;
}

async function reconcileBeforeNudge(
  agentId: string,
  taskId: string | undefined,
): Promise<boolean> {
  if (!taskId) return false;
  const reconciled = await reconcileTask(taskId);
  if (reconciled) {
    console.log(`[Health] Agent ${agentId} suppressed from nudge — task ${taskId} reconciled`);
  }
  return reconciled;
}

/**
 * Periodic sweep: run reconcileTask on any active task whose last 'completed'
 * activity is newer than its updated_at — i.e. the agent reported done but
 * status hasn't moved. Catches missed auto-promote schedules (server restart,
 * setTimeout dropped, network blip) without waiting for the per-agent
 * stall-counter to hit threshold (~21 min).
 *
 * Bounded to at most 20 tasks per cycle so a runaway DB state can't make the
 * watchdog cycle take forever. Real-world active-task counts stay under 20.
 */
async function sweepCompletionMismatches(): Promise<void> {
  const candidates = queryAll<{ id: string }>(
    `SELECT t.id FROM tasks t
     WHERE t.status IN ('assigned', 'in_progress', 'testing', 'verification')
       AND EXISTS (
         SELECT 1 FROM task_activities a
         WHERE a.task_id = t.id
           AND a.activity_type = 'completed'
           AND a.created_at > t.updated_at
           AND (julianday('now') - julianday(a.created_at)) * 1440 < ?
       )
     LIMIT 20`,
    [RECENT_COMPLETION_WINDOW_MIN],
  );

  for (const { id } of candidates) {
    try {
      await reconcileTask(id);
    } catch (err) {
      console.error(`[Health] sweep reconcile failed for ${id}:`, err);
    }
  }
}

/**
 * Status hygiene: agents whose row says status='working' but who have no
 * active task get flipped to 'standby'. The Reviewer-stuck-as-working bug
 * surfaced this — a stale 'working' flag confuses the dashboard and the
 * picker logic that prefers idle agents.
 */
function reconcileStaleWorkingAgents(): number {
  const stale = queryAll<{ id: string }>(
    `SELECT id FROM agents WHERE status = 'working' AND id NOT IN (
       SELECT assigned_agent_id FROM tasks
       WHERE assigned_agent_id IS NOT NULL
         AND status IN ('assigned', 'in_progress', 'testing', 'verification')
     )`,
  );
  if (stale.length === 0) return 0;
  const now = new Date().toISOString();
  for (const { id } of stale) {
    run(
      `UPDATE agents SET status = 'standby', updated_at = ? WHERE id = ? AND status = 'working'`,
      [now, id],
    );
  }
  console.log(`[Health] Reset ${stale.length} stale 'working' agent(s) → 'standby'`);
  return stale.length;
}

/**
 * Nudge a stuck agent: re-dispatch its task with the latest checkpoint context.
 */
export async function nudgeAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
  const activeTask = queryOne<Task>(
    `SELECT * FROM tasks WHERE assigned_agent_id = ? AND status IN ('assigned', 'in_progress', 'testing', 'verification') LIMIT 1`,
    [agentId]
  );

  if (!activeTask) {
    return { success: false, error: 'No active task for this agent' };
  }

  const now = new Date().toISOString();

  // Kill current session
  run(
    `UPDATE openclaw_sessions SET status = 'ended', ended_at = ?, updated_at = ? WHERE agent_id = ? AND status = 'active'`,
    [now, now, agentId]
  );

  // Build checkpoint context
  const checkpointCtx = buildCheckpointContext(activeTask.id);

  // Append checkpoint to task description if available
  if (checkpointCtx) {
    const newDesc = (activeTask.description || '') + checkpointCtx;
    run(
      `UPDATE tasks SET description = ?, status = 'assigned', planning_dispatch_error = NULL, updated_at = ? WHERE id = ?`,
      [newDesc, now, activeTask.id]
    );
  } else {
    run(
      `UPDATE tasks SET status = 'assigned', planning_dispatch_error = NULL, updated_at = ? WHERE id = ?`,
      [now, activeTask.id]
    );
  }

  // Re-dispatch via API
  const missionControlUrl = getMissionControlUrl();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.MC_API_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.MC_API_TOKEN}`;
  }

  try {
    const res = await fetch(`${missionControlUrl}/api/tasks/${activeTask.id}/dispatch`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errorText = await res.text();
      return { success: false, error: `Dispatch failed: ${errorText}` };
    }

    // Log nudge
    run(
      `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
       VALUES (?, ?, ?, 'status_changed', 'Agent nudged — re-dispatching with checkpoint context', ?)`,
      [uuidv4(), activeTask.id, agentId, now]
    );

    // Reset stall counter
    run(
      `UPDATE agent_health SET consecutive_stall_checks = 0, health_state = 'working', updated_at = ? WHERE agent_id = ?`,
      [now, agentId]
    );

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Get health state for all agents.
 */
export function getAllAgentHealth(): AgentHealth[] {
  return queryAll<AgentHealth>('SELECT * FROM agent_health ORDER BY updated_at DESC');
}

/**
 * Get health state for a single agent.
 */
export function getAgentHealth(agentId: string): AgentHealth | null {
  return queryOne<AgentHealth>('SELECT * FROM agent_health WHERE agent_id = ?', [agentId]) || null;
}
