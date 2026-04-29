import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { setMissionStage } from '@/lib/convoy';
import type { Convoy, MissionStage } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID_STAGES: MissionStage[] = ['backlog', 'planning', 'in_progress', 'testing', 'done'];

// PATCH /api/missions/[id]/stage
// Body: { stage: MissionStage, updated_by_agent_id?: string }
// Rule (Q9): if updated_by_agent_id is present AND target stage is 'testing' → 403
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
        { error: `stage must be one of: ${VALID_STAGES.join(', ')}` },
        { status: 400 }
      );
    }

    // Agent-driven → testing is forbidden (Q9)
    if (updated_by_agent_id && stage === 'testing') {
      return NextResponse.json(
        { error: 'Agents cannot move a mission to testing. This transition requires operator action.' },
        { status: 403 }
      );
    }

    const actor = updated_by_agent_id ?? 'operator';
    const updated = setMissionStage(convoyId, stage, actor);

    return NextResponse.json({ mission_stage: updated.mission_stage, updated_at: updated.updated_at });
  } catch (error) {
    console.error('[Missions Stage API] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update mission stage' }, { status: 500 });
  }
}
