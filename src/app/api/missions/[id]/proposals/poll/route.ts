import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { harvestProposals } from '@/lib/missions/autoPropose';
import type { Convoy } from '@/lib/types';

export const dynamic = 'force-dynamic';

// POST /api/missions/[id]/proposals/poll
//
// Reads Fury's planning session for new proposal payloads and inserts each
// new subtask as planner_proposed (deduped by title against existing
// subtasks of this mission). Safe to call repeatedly — no-op when there's
// nothing new.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const db = getDb();
    const convoy = db.prepare('SELECT * FROM convoys WHERE id = ?').get(id) as Convoy | undefined;
    if (!convoy) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

    const result = await harvestProposals(id);
    return NextResponse.json({ ok: true, ...result, mission_stage: convoy.mission_stage });
  } catch (error) {
    console.error('[Missions API] proposals/poll failed:', error);
    return NextResponse.json({ error: 'Failed to harvest proposals', code: 'internal_error', detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
