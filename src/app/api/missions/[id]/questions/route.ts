import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { Convoy } from '@/lib/types';

export const dynamic = 'force-dynamic';

function safeParseOptions(raw: string): Array<{ id: string; label: string }> | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter(o => o && typeof o === 'object' && typeof o.id === 'string' && typeof o.label === 'string')
      .map(o => ({ id: o.id, label: o.label }));
  } catch {
    return null;
  }
}

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

    const rows = db.prepare(`
      SELECT id, category, question, question_type, options, answer, answered_at, sort_order, created_at
      FROM planning_questions
      WHERE task_id = ?
      ORDER BY sort_order, created_at
    `).all(convoy.parent_task_id) as Array<{
      id: string;
      category: string;
      question: string;
      question_type: string;
      options: string | null;
      answer: string | null;
      answered_at: string | null;
      sort_order: number;
      created_at: string;
    }>;

    // Hydrate the options JSON for client consumption
    const questions = rows.map(r => ({
      ...r,
      options: r.options ? safeParseOptions(r.options) : null,
    }));

    const total = questions.length;
    const answered = questions.filter(q => (q.answer ?? '').trim().length > 0).length;

    return NextResponse.json({ questions, total, answered, all_answered: total > 0 && total === answered });
  } catch (error) {
    console.error('[Missions API] GET questions failed:', error);
    return NextResponse.json({ error: 'Failed to fetch questions', code: 'internal_error' }, { status: 500 });
  }
}
