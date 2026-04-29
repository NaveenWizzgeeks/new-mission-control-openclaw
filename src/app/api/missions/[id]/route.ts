import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { Convoy, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

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
  `).get(convoyId) as (Convoy & {
    pt_id: string; pt_title: string; pt_description: string | null;
    pt_status: string; pt_priority: string; pt_workspace_id: string;
    pt_planning_session_key: string | null; pt_planning_complete: number;
    pt_created_at: string; pt_updated_at: string;
    awaiting_input_count: number; active_agent_count: number;
  }) | undefined;

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

// PATCH /api/missions/[id] — update name/description
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
    const { name, description } = body;

    const now = new Date().toISOString();
    if (name !== undefined) {
      db.prepare(`UPDATE convoys SET name = ?, updated_at = ? WHERE id = ?`).run(name, now, id);
    }
    if (description !== undefined) {
      db.prepare(`UPDATE tasks SET description = ?, updated_at = ? WHERE id = ?`)
        .run(description, now, convoy.parent_task_id);
    }

    const updated = getMissionById(id);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('[Missions API] PATCH [id] failed:', error);
    return NextResponse.json({ error: 'Failed to update mission' }, { status: 500 });
  }
}
