/**
 * Auto-Propose Loop (Nexus Phase 6)
 *
 * After a mission's initial subtask set is complete, Fury proposes additional
 * follow-up tasks (quality, edge cases, testing gaps, polish, etc.). The
 * proposed tasks land as status='planner_proposed' so they show up in the
 * Mission Queue's "Proposed" column where the user approves or rejects.
 *
 * Flow mirrors Phase 5 planning:
 *   triggerProposal(missionId)  → sends prompt to the same Fury planning
 *                                  session via chat.send (no new session;
 *                                  Fury keeps full context).
 *   harvestProposals(missionId) → reads chat.history, parses any new
 *                                  status:'complete' spec payload, inserts
 *                                  the subtasks as planner_proposed (deduped
 *                                  by title against existing proposals).
 *
 * Codebase diff scan from §6.4 of the spec is intentionally skipped here —
 * codebase analyzer is a Phase 5b deliverable. The prompt sends the
 * completed-task summary as context instead.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { getOpenClawClient } from '@/lib/openclaw/client';
import {
  getMissionPlanningSessionKey,
  readFurySessionMessages,
  parseQuestionOrSpec,
  type GeneratedSubtaskShape,
} from '@/lib/missions/furyPlanner';
import type { Convoy, Task } from '@/lib/types';

const PROPOSAL_PROTOCOL = `FOLLOW-UP PROPOSAL PROTOCOL

The initial subtask set you planned is now complete. Inspect what was built
and propose 2 to 5 ADDITIONAL subtasks that would meaningfully improve this
work. Focus on:
- Quality / edge cases the initial set didn't cover
- Testing gaps
- Performance, observability, or documentation that would harden it
- Logical follow-ups (features that build on what was just shipped)

Only propose tasks that are clearly worth doing. If you genuinely don't see
follow-ups, return {"status":"complete","subtasks":[]}.

Reply with ONE JSON object. No prose, no markdown:
{
  "status": "complete",
  "subtasks": [
    {
      "title": "...",
      "description": "...",
      "agent_role": "builder|tester|reviewer|general",
      "priority": 3,
      "dependencies": [],
      "files_to_modify": []
    }
  ]
}`;

interface MissionRow extends Convoy {
  parent_task_id: string;
}

function getMissionAndCompletedSubtasks(missionId: string): {
  mission: MissionRow;
  parent: Task;
  completed: Array<{ title: string; description: string | null }>;
} | null {
  const db = getDb();
  const mission = db.prepare(`SELECT * FROM convoys WHERE id = ?`).get(missionId) as MissionRow | undefined;
  if (!mission) return null;
  const parent = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(mission.parent_task_id) as Task | undefined;
  if (!parent) return null;
  const completed = db.prepare(`
    SELECT t.title, t.description
    FROM convoy_subtasks cs JOIN tasks t ON cs.task_id = t.id
    WHERE cs.convoy_id = ? AND t.status = 'done' AND t.is_subtask = 1
    ORDER BY cs.sort_order
  `).all(missionId) as Array<{ title: string; description: string | null }>;
  return { mission, parent, completed };
}

function buildProposalPrompt(parent: Task, completed: Array<{ title: string; description: string | null }>): string {
  const completedBlock = completed.length > 0
    ? completed.map((c, i) => `  ${i + 1}. ${c.title}${c.description ? ` — ${c.description.slice(0, 200)}` : ''}`).join('\n')
    : '  (none)';
  return `${PROPOSAL_PROTOCOL}

ORIGINAL MISSION
Title: ${parent.title}
Description: ${parent.description || '(no description)'}

COMPLETED SUBTASKS
${completedBlock}

Now reply with ONLY the JSON object as specified.`;
}

/**
 * Sends the proposal prompt to Fury's existing planning session.
 * Returns the session key used. Idempotent at the gateway level via
 * idempotencyKey, but multiple calls will send multiple requests.
 */
export async function triggerProposal(missionId: string): Promise<{ sessionKey: string; sent: boolean }> {
  const ctx = getMissionAndCompletedSubtasks(missionId);
  if (!ctx) throw new Error(`Mission ${missionId} not found`);

  // Phase 13S.14: respect the per-mission auto-propose toggle.
  // Also short-circuit when the mission is already 'done' or 'paused' — the
  // post-last-subtask hook in tasks/[id]/route.ts can race with a manual
  // Mark Done and would otherwise burn a Fury turn proposing follow-up work
  // for a mission the operator has explicitly closed.
  const flag = getDb().prepare(`SELECT auto_propose_enabled, mission_stage FROM convoys WHERE id = ?`).get(missionId) as { auto_propose_enabled?: number; mission_stage?: string } | undefined;
  if (flag && flag.auto_propose_enabled === 0) {
    return { sessionKey: '', sent: false };
  }
  if (flag && (flag.mission_stage === 'done' || flag.mission_stage === 'paused')) {
    return { sessionKey: '', sent: false };
  }

  const sessionKey = getMissionPlanningSessionKey(missionId);
  const message = buildProposalPrompt(ctx.parent, ctx.completed);

  const client = getOpenClawClient();
  if (!client.isConnected()) await client.connect();

  await client.call('chat.send', {
    sessionKey,
    message,
    idempotencyKey: `mission-propose-${missionId}-${Date.now()}`,
  });

  return { sessionKey, sent: true };
}

export interface HarvestResult {
  inserted: number;
  total_proposed: number;
  proposed_tasks: Array<{ id: string; title: string; agent_role: string | null }>;
}

/**
 * Insert a list of subtask specs as `planner_proposed` rows on the given
 * mission. Dedupes by title against existing subtasks (any status), so it's
 * safe to call repeatedly. Resolves an agent for each spec via the same
 * workspace-first-then-global rules harvestProposals uses.
 *
 * Extracted so harvestProposals (auto-propose) and the Ask Fury chat
 * approval flow share the exact insert path — keeps proposed_tasks_count
 * recompute, broadcasts, and dedupe semantics identical across entry points.
 */
export function insertProposedSubtasks(
  missionId: string,
  specs: GeneratedSubtaskShape[],
): HarvestResult {
  if (specs.length === 0) {
    const totalNow = (getDb().prepare(`
      SELECT COUNT(*) as n FROM convoy_subtasks cs
      JOIN tasks t ON cs.task_id = t.id
      WHERE cs.convoy_id = ? AND t.status = 'planner_proposed' AND t.rejected_at IS NULL
    `).get(missionId) as { n: number }).n;
    return { inserted: 0, total_proposed: totalNow, proposed_tasks: [] };
  }

  const ctx = getMissionAndCompletedSubtasks(missionId);
  if (!ctx) throw new Error(`Mission ${missionId} not found`);

  const db = getDb();
  const existing = db.prepare(`
    SELECT t.title FROM convoy_subtasks cs JOIN tasks t ON cs.task_id = t.id WHERE cs.convoy_id = ?
  `).all(missionId) as { title: string }[];
  const seen = new Set(existing.map(e => e.title.trim().toLowerCase()));

  const inserted: HarvestResult['proposed_tasks'] = [];

  const resolveAgent = (role: string | undefined, workspaceId: string): string | null => {
    if (!role) return null;
    const ws = db.prepare(`
      SELECT id FROM agents
      WHERE LOWER(role) = LOWER(?) AND workspace_id = ? AND status != 'offline'
      ORDER BY is_master DESC, created_at ASC LIMIT 1
    `).get(role, workspaceId) as { id: string } | undefined;
    if (ws) return ws.id;
    const g = db.prepare(`
      SELECT id FROM agents
      WHERE LOWER(role) = LOWER(?) AND is_global = 1 AND status != 'offline'
      ORDER BY is_master DESC, created_at ASC LIMIT 1
    `).get(role) as { id: string } | undefined;
    return g?.id ?? null;
  };

  const tx = db.transaction(() => {
    const insertTask = db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, assigned_agent_id, workspace_id, business_id,
        workflow_template_id, convoy_id, is_subtask, created_at, updated_at
      ) VALUES (?, ?, ?, 'planner_proposed', ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    const insertJunction = db.prepare(`
      INSERT INTO convoy_subtasks (id, convoy_id, task_id, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const maxOrderRow = db.prepare(`SELECT MAX(sort_order) as max FROM convoy_subtasks WHERE convoy_id = ?`).get(missionId) as { max: number | null };
    let nextOrder = (maxOrderRow?.max ?? 0) + 1;

    for (const s of specs) {
      if (!s || typeof s.title !== 'string') continue;
      const title = s.title.trim().slice(0, 500);
      if (!title) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const taskId = uuidv4();
      const csId = uuidv4();
      const now = new Date().toISOString();
      const agentId = resolveAgent(s.agent_role, ctx.parent.workspace_id);
      const desc = (s.description || '').trim().slice(0, 10_000);

      insertTask.run(
        taskId,
        title,
        desc || null,
        ctx.parent.priority,
        agentId,
        ctx.parent.workspace_id,
        (ctx.parent as Task & { business_id?: string }).business_id ?? 'default',
        (ctx.parent as Task & { workflow_template_id?: string | null }).workflow_template_id ?? null,
        missionId,
        now,
        now,
      );
      insertJunction.run(csId, missionId, taskId, nextOrder, now);
      nextOrder += 1;
      inserted.push({ id: taskId, title, agent_role: s.agent_role ?? null });
    }

    if (inserted.length > 0) {
      db.prepare(`
        UPDATE convoys
        SET proposed_tasks_count = (
          SELECT COUNT(*) FROM convoy_subtasks cs
          JOIN tasks t ON cs.task_id = t.id
          WHERE cs.convoy_id = ? AND t.status = 'planner_proposed' AND t.rejected_at IS NULL
        ),
        updated_at = ?
        WHERE id = ?
      `).run(missionId, new Date().toISOString(), missionId);
    }
  });
  tx();

  const totalProposed = (db.prepare(`
    SELECT COUNT(*) as n FROM convoy_subtasks cs
    JOIN tasks t ON cs.task_id = t.id
    WHERE cs.convoy_id = ? AND t.status = 'planner_proposed' AND t.rejected_at IS NULL
  `).get(missionId) as { n: number }).n;

  if (inserted.length > 0) {
    const updated = db.prepare(`SELECT * FROM convoys WHERE id = ?`).get(missionId) as Convoy | undefined;
    if (updated) broadcast({ type: 'convoy_progress', payload: updated });
  }

  return { inserted: inserted.length, total_proposed: totalProposed, proposed_tasks: inserted };
}

/**
 * Reads chat.history for the mission's planning session, finds any
 * status:'complete' spec messages emitted AFTER the initial planning spec
 * (i.e., proposal payloads), and inserts each subtask as planner_proposed.
 *
 * Dedupe strategy: by task title. Any proposed task whose title already
 * exists as a non-done subtask of this mission is skipped. This keeps the
 * function safe to call repeatedly (poll cadence) without duplicating rows.
 */
export async function harvestProposals(missionId: string): Promise<HarvestResult> {
  const ctx = getMissionAndCompletedSubtasks(missionId);
  if (!ctx) throw new Error(`Mission ${missionId} not found`);

  const sessionKey = getMissionPlanningSessionKey(missionId);
  const messages = await readFurySessionMessages(sessionKey);

  // Collect all spec payloads found in the session history. The first one
  // is the initial planning spec (already materialized as 'inbox' subtasks);
  // any subsequent ones are proposals. We dedupe inserts by title against
  // *all* existing subtasks of this mission, so it doesn't matter if we
  // re-process the initial spec — its rows already exist.
  const specs: GeneratedSubtaskShape[][] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    const parsed = parseQuestionOrSpec(msg.content);
    if (parsed && 'status' in parsed && parsed.status === 'complete') {
      const subs = Array.isArray(parsed.subtasks) ? parsed.subtasks : [];
      if (subs.length > 0) specs.push(subs);
    }
  }

  // Flatten all spec batches into a single list — insertProposedSubtasks
  // dedupes by title against existing rows, so concatenation is safe.
  const flat = specs.flat();
  return insertProposedSubtasks(missionId, flat);
}
