import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
// GET /api/workspaces/[id] - Get a single workspace
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const db = getDb();
    
    // Try to find by ID or slug
    const workspace = db.prepare(
      'SELECT * FROM workspaces WHERE id = ? OR slug = ?'
    ).get(id, id);
    
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    
    return NextResponse.json(workspace);
  } catch (error) {
    console.error('Failed to fetch workspace:', error);
    return NextResponse.json({ error: 'Failed to fetch workspace' }, { status: 500 });
  }
}

// PATCH /api/workspaces/[id] - Update a workspace
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const body = await request.json();
    const { name, description, icon } = body;
    
    const db = getDb();
    
    // Check workspace exists
    const existing = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    
    // Build update query dynamically
    const updates: string[] = [];
    const values: unknown[] = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (icon !== undefined) {
      updates.push('icon = ?');
      values.push(icon);
    }
    
    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }
    
    updates.push("updated_at = datetime('now')");
    values.push(id);
    
    db.prepare(`
      UPDATE workspaces SET ${updates.join(', ')} WHERE id = ?
    `).run(...values);
    
    const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    return NextResponse.json(workspace);
  } catch (error) {
    console.error('Failed to update workspace:', error);
    return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 });
  }
}

// DELETE /api/workspaces/[id] - Delete a workspace
// ?force=true also deletes the workspace's bootstrapped agents (still refuses if tasks exist)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const force = request.nextUrl.searchParams.get('force') === 'true';

  try {
    const db = getDb();

    if (id === 'default') {
      return NextResponse.json({ error: 'Cannot delete the default workspace' }, { status: 400 });
    }

    const existing = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const taskCount = db.prepare(
      'SELECT COUNT(*) as count FROM tasks WHERE workspace_id = ?'
    ).get(id) as { count: number };

    const agentCount = db.prepare(
      'SELECT COUNT(*) as count FROM agents WHERE workspace_id = ?'
    ).get(id) as { count: number };

    if (taskCount.count > 0) {
      return NextResponse.json({
        error: 'Cannot delete workspace with existing tasks. Delete tasks first.',
        taskCount: taskCount.count,
        agentCount: agentCount.count,
      }, { status: 400 });
    }

    if (agentCount.count > 0 && !force) {
      return NextResponse.json({
        error: `Workspace has ${agentCount.count} agent(s). Pass force=true to delete them along with the workspace.`,
        taskCount: 0,
        agentCount: agentCount.count,
      }, { status: 400 });
    }

    const cascade = db.transaction(() => {
      if (force && agentCount.count > 0) {
        db.prepare(
          'DELETE FROM openclaw_sessions WHERE agent_id IN (SELECT id FROM agents WHERE workspace_id = ?)'
        ).run(id);
        db.prepare(
          'DELETE FROM messages WHERE sender_agent_id IN (SELECT id FROM agents WHERE workspace_id = ?)'
        ).run(id);
        db.prepare(
          'UPDATE knowledge_entries SET created_by_agent_id = NULL WHERE created_by_agent_id IN (SELECT id FROM agents WHERE workspace_id = ?)'
        ).run(id);
        db.prepare('DELETE FROM agents WHERE workspace_id = ?').run(id);
      }
      db.prepare('DELETE FROM workflow_templates WHERE workspace_id = ?').run(id);
      db.prepare('DELETE FROM knowledge_entries WHERE workspace_id = ?').run(id);
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    });

    cascade();

    return NextResponse.json({ success: true, deletedAgents: force ? agentCount.count : 0 });
  } catch (error) {
    console.error('Failed to delete workspace:', error);
    return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 });
  }
}
