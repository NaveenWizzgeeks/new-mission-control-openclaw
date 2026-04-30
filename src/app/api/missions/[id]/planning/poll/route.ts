import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/db';
import { addSubtasks, setMissionStage } from '@/lib/convoy';
import {
  getMissionPlanningSessionKey,
  readFurySessionMessages,
  parseQuestionOrSpec,
  type GeneratedSubtaskShape,
} from '@/lib/missions/furyPlanner';
import type { Convoy, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

function priorityFromNumber(p?: number): 'low' | 'normal' | 'high' | 'urgent' {
  if (typeof p !== 'number') return 'normal';
  if (p >= 5) return 'urgent';
  if (p === 4) return 'high';
  if (p <= 2) return 'low';
  return 'normal';
}

function resolveAgentForRole(role: string, workspaceId: string): string | null {
  const db = getDb();
  const wsAgent = db.prepare(`
    SELECT id FROM agents
    WHERE LOWER(role) = LOWER(?) AND workspace_id = ? AND status != 'offline'
    ORDER BY is_master DESC, created_at ASC LIMIT 1
  `).get(role, workspaceId) as { id: string } | undefined;
  if (wsAgent) return wsAgent.id;

  const globalAgent = db.prepare(`
    SELECT id FROM agents
    WHERE LOWER(role) = LOWER(?) AND is_global = 1 AND status != 'offline'
    ORDER BY is_master DESC, created_at ASC LIMIT 1
  `).get(role) as { id: string } | undefined;
  return globalAgent?.id ?? null;
}

interface PersistedQuestionRow {
  id: string;
  category: string;
  question: string;
  question_type: string;
  options: string | null;
  answer: string | null;
  answered_at: string | null;
  sort_order: number;
  created_at: string;
}

function safeParseOptions(raw: string | null): Array<{ id: string; label: string }> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter(o => o && typeof o.id === 'string' && typeof o.label === 'string')
      .map(o => ({ id: o.id, label: o.label }));
  } catch {
    return null;
  }
}

// POST /api/missions/[id]/planning/poll
//
// Reads new assistant messages from Fury's session, parses the latest JSON
// payload, and either:
//   - persists a new clarification question to planning_questions, or
//   - detects status='complete' → inserts subtasks via addSubtasks and
//     advances mission_stage to in_progress.
//
// Idempotent: matching on the question text dedupes when the poll fires
// multiple times before Fury has emitted a new message.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const db = getDb();
    const convoy = db.prepare('SELECT * FROM convoys WHERE id = ?').get(id) as Convoy | undefined;
    if (!convoy) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

    const parent = db.prepare('SELECT * FROM tasks WHERE id = ?').get(convoy.parent_task_id) as Task | undefined;
    if (!parent) return NextResponse.json({ error: 'Parent task missing' }, { status: 500 });

    if (!convoy.planning_started) {
      return NextResponse.json(
        { error: 'Planning has not started for this mission.', code: 'not_started' },
        { status: 400 }
      );
    }

    // Idempotency: once Fury has emitted a final spec and we've moved the
    // mission past 'planning', polling again must NOT re-read the same spec
    // and create duplicate subtasks. Bail out cleanly.
    if (convoy.mission_stage !== 'planning') {
      return NextResponse.json({
        is_complete: true,
        new_questions: 0,
        created_subtasks: 0,
        mission_stage: convoy.mission_stage,
        already_advanced: true,
      });
    }

    const sessionKey = getMissionPlanningSessionKey(id);

    // Pull all assistant messages from Fury's session
    const messages = await readFurySessionMessages(sessionKey);

    // Walk messages newest-last and find the most recent payload we can parse.
    // Process every message so we don't miss intermediate questions when the
    // poll lags behind Fury's responses.
    let detectedComplete = false;
    let completeSpecSubtasks: GeneratedSubtaskShape[] | null = null;
    let latestQuestionText: string | null = null;
    let questionsInsertedThisCall = 0;

    const existingRows = db.prepare(`
      SELECT id, question, options, sort_order
      FROM planning_questions
      WHERE task_id = ?
    `).all(convoy.parent_task_id) as Array<{ id: string; question: string; options: string | null; sort_order: number }>;
    const existingQuestionsByText = new Map(existingRows.map(r => [r.question.trim().toLowerCase(), r]));
    let nextSortOrder = existingRows.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1;
    const now = new Date().toISOString();

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      const parsed = parseQuestionOrSpec(msg.content);
      if (!parsed) continue;

      if ('status' in parsed && parsed.status === 'complete') {
        detectedComplete = true;
        completeSpecSubtasks = Array.isArray(parsed.subtasks) ? parsed.subtasks : null;
        break;
      }

      // Type guard: it's a question payload at this point.
      if (!('question' in parsed) || !Array.isArray(parsed.options)) continue;
      const q = parsed;

      const key = q.question.trim().toLowerCase();
      latestQuestionText = q.question;
      if (!existingQuestionsByText.has(key)) {
        const newId = uuidv4();
        const optsJson = JSON.stringify(q.options);
        db.prepare(`
          INSERT INTO planning_questions (id, task_id, category, question, question_type, options, sort_order, created_at)
          VALUES (?, ?, ?, ?, 'multiple_choice', ?, ?, ?)
        `).run(newId, convoy.parent_task_id, q.category ?? 'general', q.question, optsJson, nextSortOrder, now);
        existingQuestionsByText.set(key, { id: newId, question: q.question, options: optsJson, sort_order: nextSortOrder });
        nextSortOrder += 1;
        questionsInsertedThisCall += 1;
      }
    }

    // If Fury emitted the final spec, materialize subtasks + flip mission stage.
    if (detectedComplete) {
      // Single-active-mission check before flipping to in_progress
      const conflict = db.prepare(`
        SELECT c.id, c.name, t.workspace_id
        FROM convoys c JOIN tasks t ON c.parent_task_id = t.id
        WHERE c.mission_stage = 'in_progress' AND c.id != ? LIMIT 1
      `).get(id) as { id: string; name: string; workspace_id: string } | undefined;
      if (conflict) {
        return NextResponse.json(
          {
            error: 'Fury wants to start work but another mission is already in progress.',
            code: 'mission_in_progress_conflict',
            conflicting_mission: conflict,
          },
          { status: 409 }
        );
      }

      const subtaskInputs = (completeSpecSubtasks ?? []).filter(s => s && typeof s.title === 'string').map(s => ({
        title: s.title.trim().slice(0, 500),
        description: (s.description || '').trim().slice(0, 10_000),
        agent_id: s.agent_role ? resolveAgentForRole(s.agent_role, parent.workspace_id) ?? undefined : undefined,
      }));

      const created = subtaskInputs.length > 0 ? addSubtasks(id, subtaskInputs) : [];

      // Wire dependencies and priorities
      if (created.length === subtaskInputs.length && completeSpecSubtasks) {
        const priorityStmt = db.prepare(`UPDATE tasks SET priority = ?, updated_at = ? WHERE id = ?`);
        const depsStmt = db.prepare(`UPDATE convoy_subtasks SET depends_on = ? WHERE id = ?`);
        const tx = db.transaction(() => {
          for (let i = 0; i < completeSpecSubtasks!.length; i++) {
            const s = completeSpecSubtasks![i];
            const cs = created[i];
            if (!cs) continue;
            priorityStmt.run(priorityFromNumber(s.priority), now, cs.task_id);
            const depIdxs = Array.isArray(s.dependencies) ? s.dependencies.filter(d => Number.isInteger(d) && d >= 0 && d < created.length && d !== i) : [];
            if (depIdxs.length > 0) {
              const depTaskIds = depIdxs.map(d => created[d].task_id);
              depsStmt.run(JSON.stringify(depTaskIds), cs.id);
            }
          }
        });
        tx();
      }

      setMissionStage(id, 'in_progress', 'planner');

      return NextResponse.json({
        is_complete: true,
        new_questions: questionsInsertedThisCall,
        created_subtasks: created.length,
        mission_stage: 'in_progress',
      });
    }

    // Re-read questions for client convenience
    const allQuestions = (db.prepare(`
      SELECT id, category, question, question_type, options, answer, answered_at, sort_order, created_at
      FROM planning_questions
      WHERE task_id = ?
      ORDER BY sort_order, created_at
    `).all(convoy.parent_task_id) as PersistedQuestionRow[]).map(q => ({
      ...q,
      options: safeParseOptions(q.options),
    }));

    const total = allQuestions.length;
    const answered = allQuestions.filter(q => (q.answer ?? '').trim().length > 0).length;

    return NextResponse.json({
      is_complete: false,
      new_questions: questionsInsertedThisCall,
      latest_question_text: latestQuestionText,
      questions: allQuestions,
      total,
      answered,
      all_answered: total > 0 && total === answered,
      assistant_message_count: messages.filter(m => m.role === 'assistant').length,
    });
  } catch (error) {
    console.error('[Missions API] planning/poll failed:', error);
    return NextResponse.json({ error: 'Polling failed', code: 'internal_error', detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
