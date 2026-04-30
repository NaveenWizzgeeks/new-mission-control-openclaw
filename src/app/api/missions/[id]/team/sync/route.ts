import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/db';
import type { Convoy, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface ParentRoleRow { role: string; agent_id: string }

// POST /api/missions/[id]/team/sync
//
// Reads the mission's parent task workflow_template_id + task_roles, then
// propagates them to every subtask in the convoy. This is what makes the
// autensa stage-handoff engine route correctly per stage (testing → tester,
// review → reviewer, etc.) — without this, Fury's freshly-created subtasks
// inherit only assigned_agent_id and the workflow engine has no role map.
//
// Side effects per subtask:
//   - tasks.workflow_template_id ← parent's workflow_template_id
//   - DELETE FROM task_roles WHERE task_id = subtask
//   - INSERT into task_roles for each (role, agent_id) on the parent
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

    const parentRoles = db.prepare(`SELECT role, agent_id FROM task_roles WHERE task_id = ?`).all(parent.id) as ParentRoleRow[];
    const parentWorkflow = (parent as Task & { workflow_template_id?: string | null }).workflow_template_id ?? null;

    const subtaskIds = (db.prepare(`SELECT task_id FROM convoy_subtasks WHERE convoy_id = ?`).all(id) as { task_id: string }[]).map(r => r.task_id);

    if (subtaskIds.length === 0) {
      return NextResponse.json({
        ok: true,
        updated_subtasks: 0,
        workflow_template_id: parentWorkflow,
        roles_synced: parentRoles.length,
      });
    }

    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      const updateWf = db.prepare(`UPDATE tasks SET workflow_template_id = ?, updated_at = ? WHERE id = ?`);
      const wipeRoles = db.prepare(`DELETE FROM task_roles WHERE task_id = ?`);
      const insertRole = db.prepare(`
        INSERT INTO task_roles (id, task_id, role, agent_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const subtaskId of subtaskIds) {
        updateWf.run(parentWorkflow, now, subtaskId);
        wipeRoles.run(subtaskId);
        for (const r of parentRoles) {
          insertRole.run(uuidv4(), subtaskId, r.role, r.agent_id, now);
        }
      }
    });
    tx();

    return NextResponse.json({
      ok: true,
      updated_subtasks: subtaskIds.length,
      workflow_template_id: parentWorkflow,
      roles_synced: parentRoles.length,
    });
  } catch (error) {
    console.error('[Missions API] team/sync failed:', error);
    return NextResponse.json({ error: 'Failed to sync team', code: 'internal_error', detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
