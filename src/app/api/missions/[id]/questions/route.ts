import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { Convoy } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/missions/[id]/questions — list clarification questions for a mission
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const db = getDb();
    const convoy = db.prepare('SELECT * FROM convoys WHERE id = ?').get(id) as Convoy | undefined;
    if (!convoy) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

    const questions = db.prepare(`
      SELECT id, category, question, question_type, options, answer, answered_at, sort_order, created_at
      FROM planning_questions
      WHERE task_id = ?
      ORDER BY sort_order, created_at
    `).all(convoy.parent_task_id);

    const total = questions.length;
    const answered = questions.filter((q) => (q as { answer: string | null }).answer !== null).length;

    return NextResponse.json({ questions, total, answered, all_answered: total > 0 && total === answered });
  } catch (error) {
    console.error('[Missions API] GET questions failed:', error);
    return NextResponse.json({ error: 'Failed to fetch questions', code: 'internal_error' }, { status: 500 });
  }
}
