import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import type { Convoy } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/missions/[id]/reopen
 *
 * Move a mission out of 'done' back to 'in_progress' so the operator can add
 * follow-up subtasks. Stamps `reopened_at` which signals the self-heal in
 * /api/missions GET and updateConvoyProgress to NOT auto-flip the mission
 * back to 'done' just because the existing subtask counters still say
 * "all complete". The next legitimate Mark Done clears the flag.
 *
 * Idempotent at the resource level: reopening an already-reopened mission
 * just refreshes the timestamp; reopening anything that isn't 'done' returns
 * 409 so accidental clicks during planning/in_progress can't disturb state.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: convoyId } = await params;

  try {
    const db = getDb();
    const convoy = db
      .prepare('SELECT * FROM convoys WHERE id = ?')
      .get(convoyId) as Convoy | undefined;

    if (!convoy) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    if (convoy.mission_stage !== 'done') {
      return NextResponse.json(
        {
          error: 'Mission is not done. Reopen only applies to missions in the done stage.',
          code: 'mission_not_done',
          current_stage: convoy.mission_stage,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE convoys
       SET mission_stage = 'in_progress',
           status = 'active',
           reopened_at = ?,
           completed_at = NULL,
           updated_at = ?
       WHERE id = ?`,
    ).run(now, now, convoyId);

    db.prepare(
      `INSERT INTO events (id, type, task_id, message, created_at)
       VALUES (?, 'mission_stage_changed', ?, ?, ?)`,
    ).run(
      uuidv4(),
      convoy.parent_task_id,
      `Mission reopened by operator (was done)`,
      now,
    );

    const updated = db
      .prepare('SELECT * FROM convoys WHERE id = ?')
      .get(convoyId) as Convoy;
    broadcast({ type: 'convoy_progress', payload: updated });
    broadcast({
      type: 'mission_stage_changed',
      payload: {
        convoy_id: convoyId,
        stage: 'in_progress',
        actor: 'operator',
        mission_name: updated.name,
        reopened: true,
      },
    });

    return NextResponse.json({
      mission_stage: updated.mission_stage,
      status: updated.status,
      reopened_at: updated.reopened_at,
      updated_at: updated.updated_at,
    });
  } catch (error) {
    console.error('[Missions Reopen API] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to reopen mission', code: 'internal_error' },
      { status: 500 },
    );
  }
}
