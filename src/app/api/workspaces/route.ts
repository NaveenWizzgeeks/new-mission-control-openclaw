import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { bootstrapCoreAgents, cloneWorkflowTemplates } from '@/lib/bootstrap-agents';
import type { Workspace, WorkspaceStats, TaskStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Helper to generate slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// GET /api/workspaces - List all workspaces with stats
export async function GET(request: NextRequest) {
  const includeStats = request.nextUrl.searchParams.get('stats') === 'true';

  try {
    const db = getDb();
    
    if (includeStats) {
      // Get workspaces with task counts and agent counts
      const workspaces = db.prepare('SELECT * FROM workspaces ORDER BY name').all() as Workspace[];
      
      const stats: WorkspaceStats[] = workspaces.map(workspace => {
        // Phase 13N.2 + 13P.3 + 13S.15 + 13S.16: workspace task count =
        // subtasks of active missions, excluding mission-parents, rejected,
        // proposed (suggestions until approved), AND standalone tasks
        // (those have their own panel and shouldn't inflate the workspace
        // mission progress).
        const taskCounts = db.prepare(`
          SELECT t.status AS status, COUNT(*) as count
          FROM tasks t
          JOIN convoys c ON c.id = t.convoy_id
          WHERE t.workspace_id = ?
            AND c.mission_stage != 'done'
            AND t.id NOT IN (SELECT parent_task_id FROM convoys)
            AND t.rejected_at IS NULL
            AND t.status != 'planner_proposed'
          GROUP BY t.status
        `).all(workspace.id) as { status: TaskStatus; count: number }[];

        const counts: WorkspaceStats['taskCounts'] = {
          pending_dispatch: 0,
          planning: 0,
          inbox: 0,
          planner_proposed: 0,
          assigned: 0,
          in_progress: 0,
          convoy_active: 0,
          testing: 0,
          review: 0,
          verification: 0,
          done: 0,
          total: 0
        };

        taskCounts.forEach(tc => {
          counts[tc.status] = tc.count;
          counts.total += tc.count;
        });

        // Mission breakdown — separate from task counts so the UI can show
        // "N active missions" alongside "N subtasks".
        const missionRow = db.prepare(`
          SELECT
            SUM(CASE WHEN c.mission_stage IN ('backlog', 'planning', 'in_progress', 'testing', 'paused') THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN c.mission_stage = 'done' THEN 1 ELSE 0 END) AS done
          FROM convoys c
          JOIN tasks t ON t.id = c.parent_task_id
          WHERE t.workspace_id = ?
        `).get(workspace.id) as { active: number; done: number } | undefined;

        // Get agent count
        const agentCount = db.prepare(
          'SELECT COUNT(*) as count FROM agents WHERE workspace_id = ?'
        ).get(workspace.id) as { count: number };

        return {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          icon: workspace.icon,
          taskCounts: counts,
          agentCount: agentCount.count,
          missionCounts: {
            active: missionRow?.active ?? 0,
            done: missionRow?.done ?? 0,
          },
        } as WorkspaceStats;
      });
      
      return NextResponse.json(stats);
    }
    
    const workspaces = db.prepare('SELECT * FROM workspaces ORDER BY name').all();
    return NextResponse.json(workspaces);
  } catch (error) {
    console.error('Failed to fetch workspaces:', error);
    return NextResponse.json({ error: 'Failed to fetch workspaces' }, { status: 500 });
  }
}

// POST /api/workspaces - Create a new workspace
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, icon, path } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const trimmedPath = typeof path === 'string' ? path.trim() : '';
    if (trimmedPath && !trimmedPath.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(trimmedPath)) {
      return NextResponse.json({ error: 'Working directory must be an absolute path' }, { status: 400 });
    }

    const db = getDb();
    const id = crypto.randomUUID();
    const slug = generateSlug(name);

    // Check if slug already exists
    const existing = db.prepare('SELECT id FROM workspaces WHERE slug = ?').get(slug);
    if (existing) {
      return NextResponse.json({ error: 'A workspace with this name already exists' }, { status: 400 });
    }

    db.prepare(`
      INSERT INTO workspaces (id, name, slug, description, icon, path)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), slug, description || null, icon || '📁', trimmedPath || null);

    // Clone workflow templates and bootstrap core agents for the new workspace
    cloneWorkflowTemplates(db, id);
    bootstrapCoreAgents(id);

    const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    return NextResponse.json(workspace, { status: 201 });
  } catch (error) {
    console.error('Failed to create workspace:', error);
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 });
  }
}
