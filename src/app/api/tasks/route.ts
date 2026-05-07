import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { CreateTaskSchema } from '@/lib/validation';
import { populateTaskRolesFromAgents } from '@/lib/workflow-engine';
import type { Task, CreateTaskRequest, Agent } from '@/lib/types';

// GET /api/tasks - List all tasks with optional filters

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const businessId = searchParams.get('business_id');
    const workspaceId = searchParams.get('workspace_id');
    const assignedAgentId = searchParams.get('assigned_agent_id');

    // Phase 13S.18: surface is_mission_parent so the Header / queue counters
    // can exclude mission shells (the parent task is "the mission" in the UI,
    // not a worker task that should appear as queued work).
    // last_completed_activity_at lets the queue render a "Reconciling…" pill
    // instead of the stuck-task controls when an agent has reported done but
    // status hasn't caught up yet (auto-promote runs in the next few seconds).
    let sql = `
      SELECT
        t.*,
        aa.name as assigned_agent_name,
        aa.avatar_emoji as assigned_agent_emoji,
        ca.name as created_by_agent_name,
        CASE WHEN EXISTS (SELECT 1 FROM convoys c WHERE c.parent_task_id = t.id) THEN 1 ELSE 0 END AS is_mission_parent,
        (SELECT created_at FROM task_activities
           WHERE task_id = t.id AND activity_type = 'completed'
           ORDER BY created_at DESC LIMIT 1) AS last_completed_activity_at
      FROM tasks t
      LEFT JOIN agents aa ON t.assigned_agent_id = aa.id
      LEFT JOIN agents ca ON t.created_by_agent_id = ca.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (status) {
      // Support comma-separated status values (e.g., status=inbox,testing,in_progress)
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        sql += ' AND t.status = ?';
        params.push(statuses[0]);
      } else if (statuses.length > 1) {
        sql += ` AND t.status IN (${statuses.map(() => '?').join(',')})`;
        params.push(...statuses);
      }
    }
    if (businessId) {
      sql += ' AND t.business_id = ?';
      params.push(businessId);
    }
    if (workspaceId) {
      sql += ' AND t.workspace_id = ?';
      params.push(workspaceId);
    }
    if (assignedAgentId) {
      sql += ' AND t.assigned_agent_id = ?';
      params.push(assignedAgentId);
    }

    sql += ' ORDER BY t.created_at DESC';

    const tasks = queryAll<Task & { assigned_agent_name?: string; assigned_agent_emoji?: string; created_by_agent_name?: string; is_mission_parent?: number }>(sql, params);

    // Transform to include nested agent info + coerce is_mission_parent to bool
    const transformedTasks = tasks.map((task) => ({
      ...task,
      is_mission_parent: !!task.is_mission_parent,
      assigned_agent: task.assigned_agent_id
        ? {
            id: task.assigned_agent_id,
            name: task.assigned_agent_name,
            avatar_emoji: task.assigned_agent_emoji,
          }
        : undefined,
    }));

    return NextResponse.json(transformedTasks);
  } catch (error) {
    console.error('Failed to fetch tasks:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

// POST /api/tasks - Create a new task
export async function POST(request: NextRequest) {
  try {
    const body: CreateTaskRequest = await request.json();
    console.log('[POST /api/tasks] Received body:', JSON.stringify(body));

    // Validate input with Zod
    const validation = CreateTaskSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 }
      );
    }

    const validatedData = validation.data;

    // Phase 13O.6: when convoy_id is provided, route through addSubtasks so the
    // new task gets the full subtask treatment (convoy_subtasks linkage,
    // inherited workflow template, auto-drain triggered, etc.) instead of the
    // bare INSERT path which leaves it orphaned from the mission.
    if (validatedData.convoy_id) {
      // Block manual task creation against missions that are already done.
      // Without this gate, users (and auto-propose) could keep tacking work
      // onto a finished mission, which contradicts what "done" means and
      // makes the dashboard counters lie. The Reopen flow is the supported
      // way to add follow-up work.
      const stageRow = queryOne<{ mission_stage: string }>(
        'SELECT mission_stage FROM convoys WHERE id = ?',
        [validatedData.convoy_id],
      );
      if (stageRow?.mission_stage === 'done') {
        return NextResponse.json(
          {
            error: 'Mission is already done. Reopen it before adding new work.',
            code: 'mission_done',
          },
          { status: 409 },
        );
      }

      try {
        const { addSubtasks } = await import('@/lib/convoy');
        // TaskModal expresses "planning mode" by sending status='planning'.
        // addSubtasks gates planning on the requires_planning flag (which
        // TaskModal historically didn't send), so without this fallback the
        // subtask was created in 'inbox' and the convoy's auto-drain
        // dispatched it to a dynamic agent before the client could fire the
        // planning POST. Treat either signal as "this needs planning first".
        const requiresPlanning =
          validatedData.requires_planning ?? validatedData.status === 'planning';
        const created = addSubtasks(validatedData.convoy_id, [{
          title: validatedData.title,
          description: validatedData.description,
          agent_id: validatedData.assigned_agent_id ?? undefined,
          requires_planning: requiresPlanning,
        }]);
        if (created.length === 0) {
          return NextResponse.json({ error: 'Failed to add subtask to mission' }, { status: 500 });
        }
        const newTaskId = created[0].task_id;
        const task = queryOne<Task>(
          `SELECT t.*,
            aa.name as assigned_agent_name,
            aa.avatar_emoji as assigned_agent_emoji
           FROM tasks t
           LEFT JOIN agents aa ON t.assigned_agent_id = aa.id
           WHERE t.id = ?`,
          [newTaskId],
        );
        if (task) {
          broadcast({ type: 'task_created', payload: task });
          broadcast({ type: 'convoy_progress', payload: { convoy_id: validatedData.convoy_id } as Record<string, unknown> });
        }
        return NextResponse.json(task, { status: 201 });
      } catch (err) {
        console.error('[POST /api/tasks] addSubtasks failed:', err);
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'Failed to add subtask' },
          { status: 500 }
        );
      }
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    const workspaceId = validatedData.workspace_id || 'default';
    const status = validatedData.status || 'inbox';

    // Auto-assign the workspace's default workflow template
    const defaultTemplate = queryOne<{ id: string }>(
      'SELECT id FROM workflow_templates WHERE workspace_id = ? AND is_default = 1 LIMIT 1',
      [workspaceId]
    );
    const workflowTemplateId = defaultTemplate?.id || null;

    run(
      `INSERT INTO tasks (id, title, description, status, priority, assigned_agent_id, created_by_agent_id, workspace_id, business_id, due_date, workflow_template_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        validatedData.title,
        validatedData.description || null,
        status,
        validatedData.priority || 'normal',
        validatedData.assigned_agent_id || null,
        validatedData.created_by_agent_id || null,
        workspaceId,
        validatedData.business_id || 'default',
        validatedData.due_date || null,
        workflowTemplateId,
        now,
        now,
      ]
    );

    // Log event
    let eventMessage = `New task: ${validatedData.title}`;
    if (validatedData.created_by_agent_id) {
      const creator = queryOne<Agent>('SELECT name FROM agents WHERE id = ?', [validatedData.created_by_agent_id]);
      if (creator) {
        eventMessage = `${creator.name} created task: ${validatedData.title}`;
      }
    }

    run(
      `INSERT INTO events (id, type, agent_id, task_id, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), 'task_created', body.created_by_agent_id || null, id, eventMessage, now]
    );

    // Fetch created task with all joined fields
    const task = queryOne<Task>(
      `SELECT t.*,
        aa.name as assigned_agent_name,
        aa.avatar_emoji as assigned_agent_emoji,
        ca.name as created_by_agent_name,
        ca.avatar_emoji as created_by_agent_emoji
       FROM tasks t
       LEFT JOIN agents aa ON t.assigned_agent_id = aa.id
       LEFT JOIN agents ca ON t.created_by_agent_id = ca.id
       WHERE t.id = ?`,
      [id]
    );
    
    // Auto-populate workflow roles from workspace agents
    populateTaskRolesFromAgents(id, workspaceId);

    // Broadcast task creation via SSE
    if (task) {
      broadcast({
        type: 'task_created',
        payload: task,
      });
    }

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    console.error('Failed to create task:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
