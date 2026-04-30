import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { setMissionStage } from '@/lib/convoy';
import type { Convoy, MissionStage } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID_STAGES: MissionStage[] = ['backlog', 'planning', 'in_progress', 'testing', 'done', 'paused'];

// PATCH /api/missions/[id]/stage
// Body: { stage: MissionStage, updated_by_agent_id?: string }
// Rules:
//   - Q9: if updated_by_agent_id is present AND target stage is 'testing' → 403
//   - Nexus: only ONE mission may have mission_stage='in_progress' globally (across all
//     workspaces). Trying to move a second mission into 'in_progress' returns 409.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: convoyId } = await params;

  try {
    const db = getDb();
    const convoy = db.prepare('SELECT * FROM convoys WHERE id = ?').get(convoyId) as Convoy | undefined;
    if (!convoy) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

    const body = await request.json();
    const { stage, updated_by_agent_id } = body as { stage: MissionStage; updated_by_agent_id?: string };

    if (!stage || !VALID_STAGES.includes(stage)) {
      return NextResponse.json(
        { error: `stage must be one of: ${VALID_STAGES.join(', ')}`, code: 'invalid_stage' },
        { status: 400 }
      );
    }

    // Agent-driven → testing is forbidden (Q9)
    if (updated_by_agent_id && stage === 'testing') {
      return NextResponse.json(
        { error: 'Agents cannot move a mission to testing. This transition requires operator action.', code: 'agent_forbidden' },
        { status: 403 }
      );
    }

    // Nexus single-active-mission enforcement: at most one mission may be in_progress
    // globally. Skip the check if the target mission is already in_progress (idempotent).
    if (stage === 'in_progress' && convoy.mission_stage !== 'in_progress') {
      const conflict = db.prepare(`
        SELECT c.id, c.name, t.workspace_id
        FROM convoys c
        JOIN tasks t ON c.parent_task_id = t.id
        WHERE c.mission_stage = 'in_progress' AND c.id != ?
        LIMIT 1
      `).get(convoyId) as { id: string; name: string; workspace_id: string } | undefined;

      if (conflict) {
        return NextResponse.json(
          {
            error: 'Another mission is already in progress. Complete or pause it first.',
            code: 'mission_in_progress_conflict',
            conflicting_mission: { id: conflict.id, name: conflict.name, workspace_id: conflict.workspace_id },
          },
          { status: 409 }
        );
      }
    }

    const actor = updated_by_agent_id ?? 'operator';
    const updated = setMissionStage(convoyId, stage, actor);

    return NextResponse.json({ mission_stage: updated.mission_stage, updated_at: updated.updated_at });
  } catch (error) {
    console.error('[Missions Stage API] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update mission stage', code: 'internal_error' }, { status: 500 });
  }
}
