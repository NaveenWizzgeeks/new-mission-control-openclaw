import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { setMissionStage } from '@/lib/convoy';
import { kickoffMissionPlanning, getMissionPlanningSessionKey, type MissionPromptContext } from '@/lib/missions/furyPlanner';
import type { Convoy, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

// POST /api/missions/[id]/start-planning
//
// Sends the initial planning prompt to Fury via OpenClaw `chat.send`. The
// agent processes the message asynchronously; the UI then polls
// /api/missions/[id]/planning/poll to pick up new questions and the final
// subtask spec. We persist the sessionKey on the convoy row (column reused:
// codebase_summary is too on-the-nose; we use a dedicated column? — for
// now we re-use the parent task's planning_session_key so the gateway has a
// stable handle without a schema change).
//
// Idempotency: re-calling without ?regenerate=true returns the existing
// session if planning_started=1.
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

    const sessionKey = getMissionPlanningSessionKey(id);

    // Already-planned idempotency: if the session is live and we have at least
    // one question on file, just return it. Force a fresh kickoff with regenerate=true.
    const existingQuestions = db.prepare(`
      SELECT id, category, question, question_type, options, answer, answered_at, sort_order, created_at
      FROM planning_questions
      WHERE task_id = ?
      ORDER BY sort_order
    `).all(convoy.parent_task_id);

    if (!regenerate && convoy.planning_started && existingQuestions.length > 0) {
      return NextResponse.json({
        mission_stage: convoy.mission_stage,
        planning_started: true,
        session_key: sessionKey,
        questions: existingQuestions,
        regenerated: false,
      });
    }

    if (regenerate) {
      // Wipe questions so the next poll cleanly captures the new question set
      db.prepare(`DELETE FROM planning_questions WHERE task_id = ?`).run(convoy.parent_task_id);
    }

    const ctx: MissionPromptContext = {
      id: convoy.id,
      parent_task_id: convoy.parent_task_id,
      title: convoy.name || parent.title,
      description: parent.description || '',
      tech_stack_hint: convoy.tech_stack_hint,
      success_criteria: convoy.success_criteria,
      codebase_summary: convoy.codebase_summary,
      enable_existing_codebase: !!convoy.enable_existing_codebase,
    };

    try {
      await kickoffMissionPlanning(ctx);
    } catch (err) {
      console.error('[Mission start-planning] kickoff failed:', err);
      return NextResponse.json(
        {
          error: 'Could not start the planning session with Fury. Check the OpenClaw gateway connection.',
          code: 'gateway_failed',
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 502 }
      );
    }

    // Persist sessionKey on the parent task and advance mission stage atomically
    const now = new Date().toISOString();
    db.prepare(`UPDATE tasks SET planning_session_key = ?, status = 'planning', updated_at = ? WHERE id = ?`)
      .run(sessionKey, now, parent.id);
    db.prepare(`UPDATE convoys SET planning_started = 1, updated_at = ? WHERE id = ?`).run(now, id);
    setMissionStage(id, 'planning', 'operator');

    return NextResponse.json({
      mission_stage: 'planning',
      planning_started: true,
      session_key: sessionKey,
      questions: [], // empty until first poll
      regenerated: regenerate,
      note: 'Fury is preparing the first question. Poll /planning/poll for updates.',
    });
  } catch (error) {
    console.error('[Missions API] start-planning failed:', error);
    return NextResponse.json({ error: 'Failed to start planning', code: 'internal_error' }, { status: 500 });
  }
}
