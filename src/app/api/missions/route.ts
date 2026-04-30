import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createConvoy } from '@/lib/convoy';
import { CreateMissionSchema } from '@/lib/validation';
import type { Convoy, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface MissionRow extends Convoy {
  pt_id: string;
  pt_title: string;
  pt_description: string | null;
  pt_status: string;
  pt_priority: string;
  pt_workspace_id: string;
  pt_created_at: string;
  pt_updated_at: string;
  awaiting_input_count: number;
  active_agent_count: number;
}

function shapeMission(row: MissionRow) {
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
      created_at: row.pt_created_at,
      updated_at: row.pt_updated_at,
    } as Task,
  };
}

// GET /api/missions?workspace_id=xxx — list missions across workspaces or scoped
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // Accept both workspace_id and workspaceId per Nexus spec naming
  const workspaceId = searchParams.get('workspace_id') ?? searchParams.get('workspaceId');

  try {
    const db = getDb();

    const whereClause = workspaceId ? `WHERE t.workspace_id = ?` : '';
    const params = workspaceId ? [workspaceId] : [];

    const rows = db.prepare(`
      SELECT
        c.*,
        t.id           AS pt_id,
        t.title        AS pt_title,
        t.description  AS pt_description,
        t.status       AS pt_status,
        t.priority     AS pt_priority,
        t.workspace_id AS pt_workspace_id,
        t.created_at   AS pt_created_at,
        t.updated_at   AS pt_updated_at,
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
      ${whereClause}
      ORDER BY c.created_at DESC
    `).all(...params) as MissionRow[];

    return NextResponse.json(rows.map(shapeMission));
  } catch (error) {
    console.error('[Missions API] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch missions' }, { status: 500 });
  }
}

// POST /api/missions — create a mission (parent task + convoy shell with Nexus fields)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateMissionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'validation_failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const input = parsed.data;
    const db = getDb();

    // Verify workspace exists
    const workspace = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(input.workspace_id);
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found', code: 'workspace_not_found' }, { status: 404 });
    }

    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();
    const priority = input.priority ?? 'normal';

    db.prepare(`
      INSERT INTO tasks (id, title, description, status, priority, workspace_id, created_at, updated_at)
      VALUES (?, ?, ?, 'inbox', ?, ?, ?, ?)
    `).run(taskId, input.title, input.description ?? null, priority, input.workspace_id, now, now);

    // Create convoy shell (subtasks added later by Fury planning pipeline)
    const convoy = createConvoy({
      parentTaskId: taskId,
      name: input.title,
      strategy: 'planning',
      subtasks: [],
    });

    // Per Nexus flow, new missions start at mission_stage='backlog' (todo).
    // The user clicks "Start Planning" to advance → 'planning'. createConvoy
    // also flips the parent task to 'convoy_active' which we revert to 'inbox'
    // so it doesn't auto-trigger downstream dispatch.
    db.prepare(`
      UPDATE convoys
      SET mission_stage = 'backlog',
          enable_pipeline = ?,
          enable_existing_codebase = ?,
          codebase_path = ?,
          git_branch = ?,
          tech_stack_hint = ?,
          success_criteria = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.enable_pipeline ? 1 : 0,
      input.enable_existing_codebase ? 1 : 0,
      input.codebase_path ?? null,
      input.git_branch ?? null,
      input.tech_stack_hint ?? null,
      input.success_criteria ?? null,
      now,
      convoy.id
    );
    db.prepare(`UPDATE tasks SET status = 'inbox', updated_at = ? WHERE id = ?`).run(now, taskId);

    // Re-fetch with the joined parent_task fields for a complete response
    const row = db.prepare(`
      SELECT c.*, t.id AS pt_id, t.title AS pt_title, t.description AS pt_description,
             t.status AS pt_status, t.priority AS pt_priority, t.workspace_id AS pt_workspace_id,
             t.created_at AS pt_created_at, t.updated_at AS pt_updated_at,
             0 AS awaiting_input_count, 0 AS active_agent_count
      FROM convoys c JOIN tasks t ON c.parent_task_id = t.id
      WHERE c.id = ?
    `).get(convoy.id) as MissionRow;

    return NextResponse.json(shapeMission(row), { status: 201 });
  } catch (error) {
    console.error('[Missions API] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create mission', code: 'internal_error' }, { status: 500 });
  }
}
