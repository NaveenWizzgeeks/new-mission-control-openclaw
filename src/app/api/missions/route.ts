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
    auto_propose_enabled: (row as MissionRow & { auto_propose_enabled?: number }).auto_propose_enabled !== 0,
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
    completed_at: (row as MissionRow & { completed_at?: string | null }).completed_at ?? null,
    reopened_at: (row as MissionRow & { reopened_at?: string | null }).reopened_at ?? null,
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

    // Phase 13S.9 self-heal: convoys whose stored counters say completed >= total
    // but whose status is still 'active' are stale (the heal in
    // updateConvoyProgress only runs on subtask state changes; missions that
    // finished before that patch shipped, or that received auto-proposed tasks
    // after completion, never get re-evaluated). Flip them to 'done' here so
    // the dashboard badge matches reality. Skip 'paused'/'failed' — those are
    // explicit operator/system states and shouldn't be auto-overwritten.
    // Skip reopened missions too (operator moved it back to active and hasn't
    // added new work yet) so reopen doesn't silently bounce.
    db.prepare(`
      UPDATE convoys
      SET status = 'done', updated_at = ?
      WHERE status = 'active'
        AND total_subtasks > 0
        AND completed_subtasks >= total_subtasks
        AND reopened_at IS NULL
    `).run(new Date().toISOString());

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

    // Resolve the workspace's default workflow template so all subtasks
    // inherit it via addSubtasks. Without this, the workflow engine has no
    // stage→role map and the tester/reviewer stages fall back to the original
    // assigned_agent (the Builder) and break the autensa pipeline.
    const defaultWorkflow = db.prepare(`
      SELECT id FROM workflow_templates
      WHERE workspace_id = ? AND is_default = 1
      LIMIT 1
    `).get(input.workspace_id) as { id: string } | undefined;

    db.prepare(`
      INSERT INTO tasks (id, title, description, status, priority, workspace_id, workflow_template_id, created_at, updated_at)
      VALUES (?, ?, ?, 'inbox', ?, ?, ?, ?, ?)
    `).run(taskId, input.title, input.description ?? null, priority, input.workspace_id, defaultWorkflow?.id ?? null, now, now);

    // Create convoy shell (subtasks added later by Fury planning pipeline)
    const convoy = createConvoy({
      parentTaskId: taskId,
      name: input.title,
      strategy: 'planning',
      subtasks: [],
    });

    // Phase 13L Fix 2: every mission gets ONE canonical codebase_path. If the
    // user passed one (existing codebase) use it; otherwise derive a stable
    // slug under the projects root so all subtasks land in the same folder
    // instead of one folder per subtask title.
    //
    // Workspace path takes precedence over the global PROJECTS_PATH env so
    // when the user configures the office workspace to /home/wiz/Documents,
    // missions land there instead of ~/Documents/Shared/projects.
    let resolvedCodebasePath = input.codebase_path?.trim() || null;
    if (!resolvedCodebasePath) {
      const wsRow = db
        .prepare('SELECT path FROM workspaces WHERE id = ?')
        .get(input.workspace_id) as { path: string | null } | undefined;
      let basePath = wsRow?.path?.trim() || '';
      if (!basePath) {
        const { getProjectsPath } = await import('@/lib/config');
        basePath = getProjectsPath();
      }
      // Strip a trailing slash so the join produces a clean path.
      basePath = basePath.replace(/\/+$/, '');
      const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'mission';
      // Suffix with a short id to avoid collisions on identical mission names.
      const shortId = convoy.id.slice(0, 8);
      resolvedCodebasePath = `${basePath}/${slug}-${shortId}`;
    }

    // Per Nexus flow, new missions start at mission_stage='backlog' (todo).
    // The user clicks "Start Planning" to advance → 'planning'. createConvoy
    // also flips the parent task to 'convoy_active' which we revert to 'inbox'
    // so it doesn't auto-trigger downstream dispatch.
    db.prepare(`
      UPDATE convoys
      SET mission_stage = 'backlog',
          enable_pipeline = ?,
          enable_existing_codebase = ?,
          auto_propose_enabled = ?,
          codebase_path = ?,
          git_branch = ?,
          tech_stack_hint = ?,
          success_criteria = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.enable_pipeline ? 1 : 0,
      input.enable_existing_codebase ? 1 : 0,
      input.auto_propose_enabled ? 1 : 0,
      resolvedCodebasePath,
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
