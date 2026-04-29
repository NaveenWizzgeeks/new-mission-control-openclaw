import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createConvoy } from '@/lib/convoy';
import type { Convoy, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/missions?workspace_id=xxx — list missions (convoys with parent task) for a workspace
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspace_id');

  try {
    const db = getDb();

    const whereClause = workspaceId
      ? `WHERE t.workspace_id = ?`
      : '';
    const params = workspaceId ? [workspaceId] : [];

    const rows = db.prepare(`
      SELECT
        c.*,
        t.id        AS pt_id,
        t.title     AS pt_title,
        t.description AS pt_description,
        t.status    AS pt_status,
        t.priority  AS pt_priority,
        t.workspace_id AS pt_workspace_id,
        t.created_at AS pt_created_at,
        t.updated_at AS pt_updated_at,
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
    `).all(...params) as (Convoy & {
      pt_id: string; pt_title: string; pt_description: string | null;
      pt_status: string; pt_priority: string; pt_workspace_id: string;
      pt_created_at: string; pt_updated_at: string;
      awaiting_input_count: number; active_agent_count: number;
    })[];

    const missions = rows.map(row => ({
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
        created_at: row.pt_created_at,
        updated_at: row.pt_updated_at,
      } as Task,
    }));

    return NextResponse.json(missions);
  } catch (error) {
    console.error('[Missions API] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch missions' }, { status: 500 });
  }
}

// POST /api/missions — create a mission (parent task + convoy shell)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, workspace_id, priority = 'normal' } = body;

    if (!title || !workspace_id) {
      return NextResponse.json({ error: 'title and workspace_id are required' }, { status: 400 });
    }

    const db = getDb();

    // Verify workspace exists
    const workspace = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspace_id);
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    // Create the parent task in planning status
    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO tasks (id, title, description, status, priority, workspace_id, created_at, updated_at)
      VALUES (?, ?, ?, 'planning', ?, ?, ?, ?)
    `).run(taskId, title, description ?? null, priority, workspace_id, now, now);

    // Create convoy shell (no subtasks yet; planning will add them)
    const convoy = createConvoy({
      parentTaskId: taskId,
      name: title,
      strategy: 'planning',
      subtasks: [],
    });

    const parentTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task;

    return NextResponse.json({ convoy, parent_task: parentTask }, { status: 201 });
  } catch (error) {
    console.error('[Missions API] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create mission' }, { status: 500 });
  }
}
