import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { UpdateMissionSchema } from '@/lib/validation';
import type { Convoy, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface MissionDetailRow extends Convoy {
  pt_id: string; pt_title: string; pt_description: string | null;
  pt_status: string; pt_priority: string; pt_workspace_id: string;
  pt_planning_session_key: string | null; pt_planning_complete: number;
  pt_created_at: string; pt_updated_at: string;
  awaiting_input_count: number; active_agent_count: number;
}

function getMissionById(convoyId: string) {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      c.*,
      t.id          AS pt_id,
      t.title       AS pt_title,
      t.description AS pt_description,
      t.status      AS pt_status,
      t.priority    AS pt_priority,
      t.workspace_id AS pt_workspace_id,
      t.planning_session_key AS pt_planning_session_key,
      t.planning_complete AS pt_planning_complete,
      t.created_at  AS pt_created_at,
      t.updated_at  AS pt_updated_at,
      (
        SELECT COUNT(*) FROM planning_questions pq
        WHERE pq.task_id = c.parent_task_id AND pq.answer IS NULL
      ) AS awaiting_input_count,
      (
        SELECT COUNT(DISTINCT cs2.task_id)
        FROM convoy_subtasks cs2
        JOIN tasks t2 ON cs2.task_id = t2.id
        WHERE cs2.convoy_id = c.id
          AND t2.status IN ('assigned', 'in_progress', 'testing', 'verification')
      ) AS active_agent_count
    FROM convoys c
    JOIN tasks t ON c.parent_task_id = t.id
    WHERE c.id = ?
  `).get(convoyId) as MissionDetailRow | undefined;

  if (!row) return null;

  const subtasks = db.prepare(`
    SELECT cs.*, t.title as task_title, t.status as task_status,
           t.assigned_agent_id as task_assigned_agent_id
    FROM convoy_subtasks cs
    JOIN tasks t ON cs.task_id = t.id
    WHERE cs.convoy_id = ?
    ORDER BY cs.sort_order
  `).all(convoyId) as Array<{
    id: string; convoy_id: string; task_id: string; sort_order: number;
    depends_on: string | null; created_at: string;
    task_title: string; task_status: string; task_assigned_agent_id: string | null;
  }>;

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    mission_stage: row.mission_stage ?? 'backlog',
    decomposition_strategy: row.decomposition_strategy,
    total_subtasks: row.total_subtasks,
    completed_subtasks: row.completed_subtasks,
    failed_subtasks: row.failed_subtasks,
    enable_pipeline: !!row.enable_pipeline,
    enable_existing_codebase: !!row.enable_existing_codebase,
    codebase_path: row.codebase_path ?? null,
    git_branch: row.git_branch ?? null,
    tech_stack_hint: row.tech_stack_hint ?? null,
    success_criteria: row.success_criteria ?? null,
    codebase_summary: row.codebase_summary ?? null,
    planning_started: !!row.planning_started,
    proposed_tasks_count: row.proposed_tasks_count ?? 0,
    active_agents_count: row.active_agents_count ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
    awaiting_input_count: row.awaiting_input_count,
    active_agent_count: row.active_agent_count,
    parent_task: {
      id: row.pt_id,
      title: row.pt_title,
      description: row.pt_description,
      status: row.pt_status,
      priority: row.pt_priority,
      workspace_id: row.pt_workspace_id,
      planning_session_key: row.pt_planning_session_key,
      planning_complete: row.pt_planning_complete,
      created_at: row.pt_created_at,
      updated_at: row.pt_updated_at,
    } as Task,
    subtasks: subtasks.map(s => ({
      id: s.id,
      convoy_id: s.convoy_id,
      task_id: s.task_id,
      sort_order: s.sort_order,
      depends_on: s.depends_on ? JSON.parse(s.depends_on) : undefined,
      created_at: s.created_at,
      task: {
        id: s.task_id,
        title: s.task_title,
        status: s.task_status,
        assigned_agent_id: s.task_assigned_agent_id,
      } as Task,
    })),
  };
}

// GET /api/missions/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const mission = getMissionById(id);
    if (!mission) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    return NextResponse.json(mission);
  } catch (error) {
    console.error('[Missions API] GET [id] failed:', error);
    return NextResponse.json({ error: 'Failed to fetch mission' }, { status: 500 });
  }
}

// PATCH /api/missions/[id] — update name/description + Nexus mission fields
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const db = getDb();
    const convoy = db.prepare('SELECT * FROM convoys WHERE id = ?').get(id) as Convoy | undefined;
    if (!convoy) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

    const body = await request.json();
    const parsed = UpdateMissionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'validation_failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const input = parsed.data;
    const now = new Date().toISOString();

    // Build dynamic UPDATE for convoys columns
    const convoyUpdates: string[] = [];
    const convoyValues: unknown[] = [];

    const setIf = <K extends keyof typeof input>(col: string, key: K, transform?: (v: NonNullable<typeof input[K]>) => unknown) => {
      const v = input[key];
      if (v !== undefined) {
        convoyUpdates.push(`${col} = ?`);
        convoyValues.push(v === null ? null : transform ? transform(v as NonNullable<typeof input[K]>) : v);
      }
    };

    setIf('name', 'name');
    setIf('enable_pipeline', 'enable_pipeline', (v) => (v ? 1 : 0));
    setIf('enable_existing_codebase', 'enable_existing_codebase', (v) => (v ? 1 : 0));
    setIf('codebase_path', 'codebase_path');
    setIf('git_branch', 'git_branch');
    setIf('tech_stack_hint', 'tech_stack_hint');
    setIf('success_criteria', 'success_criteria');
    setIf('codebase_summary', 'codebase_summary');
    setIf('planning_started', 'planning_started', (v) => (v ? 1 : 0));

    if (convoyUpdates.length > 0) {
      convoyUpdates.push('updated_at = ?');
      convoyValues.push(now, id);
      db.prepare(`UPDATE convoys SET ${convoyUpdates.join(', ')} WHERE id = ?`).run(...convoyValues);
    }

    if (input.description !== undefined) {
      db.prepare(`UPDATE tasks SET description = ?, updated_at = ? WHERE id = ?`)
        .run(input.description, now, convoy.parent_task_id);
    }

    const updated = getMissionById(id);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('[Missions API] PATCH [id] failed:', error);
    return NextResponse.json({ error: 'Failed to update mission', code: 'internal_error' }, { status: 500 });
  }
}

// DELETE /api/missions/[id]
// Removes the mission and the parent task. Several child tables reference
// tasks(id) with ON DELETE NO ACTION, so we explicitly clean those rows
// inside one transaction before dropping the parent task. The convoys row
// and convoy_subtasks fall out via the existing CASCADE FKs on parent_task_id.
//
// Subtask `tasks` rows are kept by default; pass ?delete_subtasks=true to drop them too.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleteSubtasks = new URL(request.url).searchParams.get('delete_subtasks') === 'true';

  try {
    const db = getDb();
    const convoy = db.prepare('SELECT * FROM convoys WHERE id = ?').get(id) as Convoy | undefined;
    if (!convoy) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

    const subtaskIds = (db.prepare('SELECT task_id FROM convoy_subtasks WHERE convoy_id = ?').all(id) as { task_id: string }[]).map(r => r.task_id);
    const allTaskIds = deleteSubtasks ? [convoy.parent_task_id, ...subtaskIds] : [convoy.parent_task_id];

    const tx = db.transaction(() => {
      if (allTaskIds.length === 0) return;
      const placeholders = allTaskIds.map(() => '?').join(',');

      // Tables with NO ACTION FKs to tasks(id) — delete refs first to unblock the task delete.
      // Listed per `PRAGMA foreign_key_list` audit (2026-04-30).
      db.prepare(`DELETE FROM events WHERE task_id IN (${placeholders})`).run(...allTaskIds);
      db.prepare(`DELETE FROM agent_health WHERE task_id IN (${placeholders})`).run(...allTaskIds);
      db.prepare(`DELETE FROM openclaw_sessions WHERE task_id IN (${placeholders})`).run(...allTaskIds);
      db.prepare(`DELETE FROM cost_events WHERE task_id IN (${placeholders})`).run(...allTaskIds);
      db.prepare(`DELETE FROM workspace_ports WHERE task_id IN (${placeholders})`).run(...allTaskIds);
      db.prepare(`DELETE FROM workspace_merges WHERE task_id IN (${placeholders})`).run(...allTaskIds);
      db.prepare(`DELETE FROM conversations WHERE task_id IN (${placeholders})`).run(...allTaskIds);
      db.prepare(`DELETE FROM rollback_history WHERE task_id IN (${placeholders})`).run(...allTaskIds);
      db.prepare(`DELETE FROM skill_reports WHERE task_id IN (${placeholders})`).run(...allTaskIds);
      db.prepare(`DELETE FROM content_inventory WHERE task_id IN (${placeholders})`).run(...allTaskIds);
      db.prepare(`UPDATE knowledge_entries SET task_id = NULL WHERE task_id IN (${placeholders})`).run(...allTaskIds);
      db.prepare(`UPDATE ideas SET task_id = NULL WHERE task_id IN (${placeholders})`).run(...allTaskIds);
      db.prepare(`UPDATE product_skills SET created_by_task_id = NULL WHERE created_by_task_id IN (${placeholders})`).run(...allTaskIds);
      db.prepare(`DELETE FROM agent_mailbox WHERE convoy_id = ?`).run(id);

      // Tasks delete cascades: convoys (via parent_task_id), convoy_subtasks (via convoy_id chain),
      // planning_questions, planning_specs, task_activities, task_deliverables, task_notes,
      // task_roles, user_task_reads, work_checkpoints — all CASCADE on tasks(id).
      db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...allTaskIds);
    });
    tx();

    return NextResponse.json({ success: true, deleted_subtasks: deleteSubtasks, removed_subtask_count: deleteSubtasks ? subtaskIds.length : 0 });
  } catch (error) {
    console.error('[Missions API] DELETE [id] failed:', error);
    return NextResponse.json({ error: 'Failed to delete mission', code: 'internal_error' }, { status: 500 });
  }
}
