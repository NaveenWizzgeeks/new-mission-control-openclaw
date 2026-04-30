import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { triggerProposal } from '@/lib/missions/autoPropose';
import type { Convoy } from '@/lib/types';

export const dynamic = 'force-dynamic';

// POST /api/missions/[id]/propose
//
// Sends a "propose follow-up tasks" prompt to Fury's existing planning
// session. Returns immediately; the UI then polls /proposals/poll to harvest
// any subtasks Fury emits.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const db = getDb();
    const convoy = db.prepare('SELECT * FROM convoys WHERE id = ?').get(id) as Convoy | undefined;
    if (!convoy) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

    if (convoy.mission_stage === 'done' || convoy.mission_stage === 'paused') {
      return NextResponse.json(
        { error: `Mission is ${convoy.mission_stage}; resume it before requesting more proposals.`, code: 'invalid_stage' },
        { status: 400 }
      );
    }

    try {
      await triggerProposal(id);
    } catch (err) {
      console.error('[Mission propose] trigger failed:', err);
      return NextResponse.json(
        { error: 'Could not reach Fury to request proposals.', code: 'gateway_failed', detail: err instanceof Error ? err.message : String(err) },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, note: 'Proposal requested. Poll /proposals/poll to harvest.' });
  } catch (error) {
    console.error('[Missions API] propose failed:', error);
    return NextResponse.json({ error: 'Failed to request proposals', code: 'internal_error' }, { status: 500 });
  }
}
