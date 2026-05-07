import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Phase 13P.2: list standalone tasks in a workspace.
 *
 * "Standalone" = a task that:
 *   - belongs to this workspace
 *   - has convoy_id = NULL (not a subtask)
 *   - is NOT the parent task of any convoy (those are mission rows, not standalone)
 *
 * Returned with assigned-agent join so the panel can show who's on it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idOrSlug } = await params;

  // Accept either workspace id or slug — the workspace page passes slug.
  const ws = queryOne<{ id: string }>(
    `SELECT id FROM workspaces WHERE slug = ? OR id = ? LIMIT 1`,
    [idOrSlug, idOrSlug],
  );
  if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

  const items = queryAll(`
    SELECT t.id, t.title, t.description, t.status, t.priority,
           t.assigned_agent_id, a.name AS assigned_agent_name, a.avatar_emoji AS assigned_agent_emoji,
           t.created_at, t.updated_at, t.due_date
    FROM tasks t
    LEFT JOIN agents a ON a.id = t.assigned_agent_id
    WHERE t.workspace_id = ?
      AND t.convoy_id IS NULL
      AND t.id NOT IN (SELECT parent_task_id FROM convoys)
    ORDER BY t.created_at DESC
  `, [ws.id]);

  return NextResponse.json({ items });
}
