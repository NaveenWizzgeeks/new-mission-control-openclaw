import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { setMissionStage } from '@/lib/convoy';
import { generateClarifyingQuestions, type MissionContext } from '@/lib/missions/planningPipeline';
import type { Convoy, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

// POST /api/missions/[id]/start-planning
//
// Kicks off Fury's clarification phase. Sets mission_stage='planning',
// planning_started=1, then calls Fury via the gateway for 3-7 clarifying
// questions which are persisted to planning_questions.
//
// Idempotent: if planning_started=1 and unanswered questions exist, returns
// the existing question set without calling Fury again. Force a regenerate
// with ?regenerate=true.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const regenerate = new URL(request.url).searchParams.get('regenerate') === 'true';

  try {
    const db = getDb();
    const convoy = db.prepare('SELECT * FROM convoys WHERE id = ?').get(id) as Convoy | undefined;
    if (!convoy) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

    const parent = db.prepare('SELECT * FROM tasks WHERE id = ?').get(convoy.parent_task_id) as Task | undefined;
    if (!parent) return NextResponse.json({ error: 'Parent task missing' }, { status: 500 });

    if (!convoy.enable_pipeline) {
      return NextResponse.json(
        { error: 'Mission has pipeline disabled. Use the "Begin" action to skip planning.', code: 'pipeline_disabled' },
        { status: 400 }
      );
    }

    // Already-planned idempotency: return existing questions unless regenerate=true
    const existing = db.prepare(`
      SELECT id, category, question, question_type, options, answer, answered_at, sort_order, created_at
      FROM planning_questions
      WHERE task_id = ?
      ORDER BY sort_order
    `).all(convoy.parent_task_id);

    if (!regenerate && convoy.planning_started && existing.length > 0) {
      return NextResponse.json({
        mission_stage: convoy.mission_stage,
        planning_started: true,
        questions: existing,
        regenerated: false,
      });
    }

    const ctx: MissionContext = {
      id: convoy.id,
      parent_task_id: convoy.parent_task_id,
      title: convoy.name || parent.title,
      description: parent.description || '',
      tech_stack_hint: convoy.tech_stack_hint,
      success_criteria: convoy.success_criteria,
      codebase_summary: convoy.codebase_summary,
      enable_existing_codebase: !!convoy.enable_existing_codebase,
    };

    let inserted;
    try {
      inserted = await generateClarifyingQuestions(ctx);
    } catch (err) {
      console.error('[Mission start-planning] Fury question generation failed:', err);
      return NextResponse.json(
        { error: 'Planner failed to generate questions. Check gateway connectivity.', code: 'planner_failed', detail: err instanceof Error ? err.message : String(err) },
        { status: 502 }
      );
    }

    // Advance mission state
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE convoys
      SET planning_started = 1,
          updated_at = ?
      WHERE id = ?
    `).run(now, id);
    setMissionStage(id, 'planning', 'operator');

    return NextResponse.json({
      mission_stage: 'planning',
      planning_started: true,
      questions: inserted,
      regenerated: regenerate,
    });
  } catch (error) {
    console.error('[Missions API] start-planning failed:', error);
    return NextResponse.json({ error: 'Failed to start planning', code: 'internal_error' }, { status: 500 });
  }
}
