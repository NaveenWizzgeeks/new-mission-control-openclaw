import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { addSubtasks, setMissionStage } from '@/lib/convoy';
import { generateSubtasks, mapPriority, type MissionContext, type QAPair } from '@/lib/missions/planningPipeline';
import type { Convoy, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface AgentRow { id: string; role: string; workspace_id: string; is_global: number }

// Resolve a concrete agent_id for a Nexus agent_role. Preference order:
//   1. an agent in this workspace whose role matches (case-insensitive)
//   2. a global agent whose role matches
//   3. null (user assigns later)
function resolveAgentForRole(role: string, workspaceId: string): string | null {
  const db = getDb();
  const wsAgent = db.prepare(`
    SELECT id, role, workspace_id, is_global
    FROM agents
    WHERE LOWER(role) = LOWER(?) AND workspace_id = ? AND status != 'offline'
    ORDER BY is_master DESC, created_at ASC
    LIMIT 1
  `).get(role, workspaceId) as AgentRow | undefined;
  if (wsAgent) return wsAgent.id;

  const globalAgent = db.prepare(`
    SELECT id, role, workspace_id, is_global
    FROM agents
    WHERE LOWER(role) = LOWER(?) AND is_global = 1 AND status != 'offline'
    ORDER BY is_master DESC, created_at ASC
    LIMIT 1
  `).get(role) as AgentRow | undefined;
  if (globalAgent) return globalAgent.id;

  return null;
}

// POST /api/missions/[id]/generate-tasks
//
// Reads answered clarification questions, calls Fury for the subtask plan,
// inserts subtasks via addSubtasks (creates tasks + convoy_subtasks), assigns
// agents by role where possible, and advances the mission to in_progress
// (subject to the single-active-mission check).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const db = getDb();
    const convoy = db.prepare('SELECT * FROM convoys WHERE id = ?').get(id) as Convoy | undefined;
    if (!convoy) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

    const parent = db.prepare('SELECT * FROM tasks WHERE id = ?').get(convoy.parent_task_id) as Task | undefined;
    if (!parent) return NextResponse.json({ error: 'Parent task missing' }, { status: 500 });

    if (convoy.mission_stage !== 'planning') {
      return NextResponse.json(
        { error: `Mission must be in planning to generate tasks (currently ${convoy.mission_stage}).`, code: 'invalid_stage' },
        { status: 400 }
      );
    }

    // Single-active mission check before transitioning to in_progress
    const conflict = db.prepare(`
      SELECT c.id, c.name, t.workspace_id
      FROM convoys c JOIN tasks t ON c.parent_task_id = t.id
      WHERE c.mission_stage = 'in_progress' AND c.id != ? LIMIT 1
    `).get(id) as { id: string; name: string; workspace_id: string } | undefined;
    if (conflict) {
      return NextResponse.json(
        {
          error: 'Another mission is already in progress. Pause or complete it before generating tasks for this one.',
          code: 'mission_in_progress_conflict',
          conflicting_mission: conflict,
        },
        { status: 409 }
      );
    }

    // Pull answered Q&A
    const qas = db.prepare(`
      SELECT category, question, answer
      FROM planning_questions
      WHERE task_id = ? AND answer IS NOT NULL AND TRIM(answer) != ''
      ORDER BY sort_order, created_at
    `).all(convoy.parent_task_id) as QAPair[];

    const ctx: MissionContext = {
      id: convoy.id,
      parent_task_id: convoy.parent_task_id,
      title: convoy.name || parent.title,
      description: parent.description || '',
      tech_stack_hint: convoy.tech_stack_hint,
      success_criteria: convoy.success_criteria,
      codebase_summary: convoy.codebase_summary,
      enable_existing_codebase: !!convoy.enable_existing_codebase,
    };

    let subtasks;
    try {
      subtasks = await generateSubtasks(ctx, qas);
    } catch (err) {
      console.error('[Mission generate-tasks] Fury subtask generation failed:', err);
      return NextResponse.json(
        { error: 'Planner failed to generate subtasks. Check gateway connectivity and retry.', code: 'planner_failed', detail: err instanceof Error ? err.message : String(err) },
        { status: 502 }
      );
    }

    // Map subtasks to addSubtasks() input shape with role→agent resolution
    const subtaskInput = subtasks.map(s => ({
      title: s.title,
      description: s.description,
      agent_id: resolveAgentForRole(s.agent_role, parent.workspace_id) ?? undefined,
      // Convert dependencies (array of indices) to depends_on hash referencing future task ids.
      // We don't yet know the inserted task ids, so we'll wire dependencies in a second pass below.
    }));

    const created = addSubtasks(id, subtaskInput);

    // Second pass: now that tasks have ids, persist depends_on as JSON arrays of task_ids.
    if (subtasks.some(s => (s.dependencies?.length ?? 0) > 0) && created.length === subtasks.length) {
      const now = new Date().toISOString();
      const updateStmt = db.prepare(`UPDATE convoy_subtasks SET depends_on = ? WHERE id = ?`);
      const tasksUpdate = db.prepare(`UPDATE tasks SET priority = ?, updated_at = ? WHERE id = ?`);

      const tx = db.transaction(() => {
        for (let i = 0; i < subtasks.length; i++) {
          const s = subtasks[i];
          const cs = created[i];
          if (!cs) continue;

          // Map index-based dependencies to task ids; skip out-of-range/self refs
          const depsTaskIds = (s.dependencies || [])
            .filter(d => d !== i && d >= 0 && d < created.length)
            .map(d => created[d].task_id);
          if (depsTaskIds.length > 0) {
            updateStmt.run(JSON.stringify(depsTaskIds), cs.id);
          }

          tasksUpdate.run(mapPriority(s.priority), now, cs.task_id);
        }
      });
      tx();
    }

    // Advance mission to in_progress
    setMissionStage(id, 'in_progress', 'planner');

    return NextResponse.json({
      success: true,
      created_count: created.length,
      mission_stage: 'in_progress',
    });
  } catch (error) {
    console.error('[Missions API] generate-tasks failed:', error);
    return NextResponse.json({ error: 'Failed to generate tasks', code: 'internal_error' }, { status: 500 });
  }
}
