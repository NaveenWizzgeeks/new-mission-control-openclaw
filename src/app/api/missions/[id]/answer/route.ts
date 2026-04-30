import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { sendAnswerToFury, getMissionPlanningSessionKey } from '@/lib/missions/furyPlanner';
import type { Convoy } from '@/lib/types';

export const dynamic = 'force-dynamic';

// POST /api/missions/[id]/answer
// Body: { question_id: string, answer: string }
//
// Persists the answer locally AND forwards it into Fury's planning session
// via OpenClaw `chat.send`. UI then polls /planning/poll to pick up Fury's
// next question (or final spec).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { question_id, answer } = body as { question_id?: string; answer?: string };

    if (!question_id || typeof question_id !== 'string') {
      return NextResponse.json({ error: 'question_id is required', code: 'validation_failed' }, { status: 400 });
    }
    if (typeof answer !== 'string') {
      return NextResponse.json({ error: 'answer must be a string', code: 'validation_failed' }, { status: 400 });
    }
    const trimmed = answer.trim();
    if (trimmed.length === 0) {
      return NextResponse.json({ error: 'answer must not be empty', code: 'validation_failed' }, { status: 400 });
    }
    if (trimmed.length > 5000) {
      return NextResponse.json({ error: 'answer must be <= 5000 chars', code: 'validation_failed' }, { status: 400 });
    }

    const db = getDb();
    const convoy = db.prepare('SELECT * FROM convoys WHERE id = ?').get(id) as Convoy | undefined;
    if (!convoy) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

    const question = db.prepare('SELECT id, task_id, question FROM planning_questions WHERE id = ?').get(question_id) as { id: string; task_id: string; question: string } | undefined;
    if (!question) return NextResponse.json({ error: 'Question not found' }, { status: 404 });
    if (question.task_id !== convoy.parent_task_id) {
      return NextResponse.json({ error: 'Question does not belong to this mission', code: 'mismatch' }, { status: 400 });
    }

    db.prepare(`UPDATE planning_questions SET answer = ?, answered_at = ? WHERE id = ?`)
      .run(trimmed, new Date().toISOString(), question_id);

    // Forward to Fury so she can ask the next question or finalize.
    const sessionKey = getMissionPlanningSessionKey(id);
    try {
      await sendAnswerToFury(sessionKey, question.question, trimmed);
    } catch (err) {
      console.error('[Mission answer] forward to Fury failed:', err);
      // Answer is saved locally; surface the gateway hiccup so UI can retry the
      // forward (re-saving the same answer is idempotent — no duplicate row).
      return NextResponse.json(
        {
          success: false,
          saved_locally: true,
          error: 'Saved your answer, but could not deliver it to Fury.',
          code: 'gateway_failed',
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Missions API] POST answer failed:', error);
    return NextResponse.json({ error: 'Failed to save answer', code: 'internal_error' }, { status: 500 });
  }
}
