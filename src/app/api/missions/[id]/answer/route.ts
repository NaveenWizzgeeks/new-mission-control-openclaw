import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { Convoy } from '@/lib/types';

export const dynamic = 'force-dynamic';

// POST /api/missions/[id]/answer
// Body: { question_id: string, answer: string }
//
// Persists an answer to a clarification question. The question must belong
// to the mission's parent_task_id (prevents cross-mission tampering).
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
    if (answer.length > 5000) {
      return NextResponse.json({ error: 'answer must be <= 5000 chars', code: 'validation_failed' }, { status: 400 });
    }

    const db = getDb();
    const convoy = db.prepare('SELECT * FROM convoys WHERE id = ?').get(id) as Convoy | undefined;
    if (!convoy) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

    const question = db.prepare('SELECT id, task_id FROM planning_questions WHERE id = ?').get(question_id) as { id: string; task_id: string } | undefined;
    if (!question) return NextResponse.json({ error: 'Question not found' }, { status: 404 });
    if (question.task_id !== convoy.parent_task_id) {
      return NextResponse.json({ error: 'Question does not belong to this mission', code: 'mismatch' }, { status: 400 });
    }

    const trimmed = answer.trim();
    db.prepare(`
      UPDATE planning_questions
      SET answer = ?, answered_at = ?
      WHERE id = ?
    `).run(trimmed, trimmed.length > 0 ? new Date().toISOString() : null, question_id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Missions API] POST answer failed:', error);
    return NextResponse.json({ error: 'Failed to save answer', code: 'internal_error' }, { status: 500 });
  }
}
