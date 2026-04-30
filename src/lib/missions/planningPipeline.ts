/**
 * Fury Planning Pipeline (Nexus Phase 5)
 *
 * Two stateless gateway calls drive the mission planning loop:
 *
 *   1. generateClarifyingQuestions(mission) — Fury proposes 3-7 questions
 *      to disambiguate the mission scope. Persisted to planning_questions
 *      linked to the mission's parent_task_id.
 *
 *   2. generateSubtasks(mission, qaPairs) — given full context + answered
 *      questions, Fury returns a JSON array of subtasks. Caller inserts
 *      those into tasks + convoy_subtasks and advances the mission.
 *
 * Both helpers use src/lib/autopilot/llm.ts `completeJSON`, which hits the
 * gateway's OpenAI-compatible /v1/chat/completions endpoint via Fury's model.
 *
 * Codebase analysis (Step 1 of the spec) is deferred to Phase 5b — these
 * helpers operate on the textual mission context only for now.
 */

import { v4 as uuidv4 } from 'uuid';
import { completeJSON } from '@/lib/autopilot/llm';
import { getDb } from '@/lib/db';

const PLANNER_MODEL = process.env.PLANNER_MODEL || process.env.AUTOPILOT_MODEL || 'anthropic/claude-sonnet-4-6';

export interface MissionContext {
  id: string;
  parent_task_id: string;
  title: string;
  description: string;
  tech_stack_hint?: string | null;
  success_criteria?: string | null;
  codebase_summary?: string | null;
  enable_existing_codebase?: boolean;
}

export interface GeneratedQuestion {
  category: string; // 'scope' | 'tech' | 'constraints' | 'edge_cases' | 'success' | etc.
  question: string;
}

export interface GeneratedSubtask {
  title: string;
  description: string;
  agent_role: 'planner' | 'builder' | 'tester' | 'reviewer' | 'general';
  priority?: 1 | 2 | 3 | 4 | 5;
  dependencies?: number[]; // indices of other subtasks in this array that must complete first
  estimated_hours?: number;
  files_to_modify?: string[];
}

const QUESTION_PROMPT = `You are Fury, the planning agent for Autensa Mission Control. You decompose missions into work plans for an AI agent team.

A mission has just been created. Before generating subtasks, ask 3 to 7 sharp clarifying questions that will materially change the work plan if answered differently. Aim for questions about: scope boundaries, technical constraints, success criteria, edge cases, and integration points.

Skip questions whose answers are already obvious from the mission description.

Return ONLY a JSON object with this exact shape:
{
  "questions": [
    { "category": "scope|tech|constraints|edge_cases|success|integration", "question": "..." }
  ]
}

No prose, no markdown, no commentary.

MISSION:
Title: {{TITLE}}
Description: {{DESCRIPTION}}
Tech stack hint: {{TECH_STACK_HINT}}
Success criteria: {{SUCCESS_CRITERIA}}
{{CODEBASE_BLOCK}}`;

const SUBTASK_PROMPT = `You are Fury, the planning agent for Autensa Mission Control. The user has clarified the mission. Decompose it into a sequenced subtask list for the agent team.

Constraints:
- Each subtask is a single actionable work item assigned to one agent role: planner | builder | tester | reviewer | general
- Tasks run SEQUENTIALLY by default (one at a time). Use "dependencies" to express ordering when a task strictly needs another to be done first.
- Prefer 3-10 subtasks unless the mission is trivial. Do not invent work; stay scoped to the mission and the user's answers.
- Builder tasks build features; tester tasks add coverage; reviewer tasks gate merges. Use "general" only when no other role fits.
- "priority" is 1 (lowest) to 5 (highest, urgent). Most subtasks should be priority 3.

Return ONLY a JSON object with this exact shape:
{
  "subtasks": [
    {
      "title": "Short imperative title",
      "description": "1-3 sentences. Concrete acceptance criteria if helpful.",
      "agent_role": "builder",
      "priority": 3,
      "dependencies": [],
      "estimated_hours": 2,
      "files_to_modify": ["src/lib/foo.ts"]
    }
  ]
}

No prose, no markdown, no commentary.

MISSION:
Title: {{TITLE}}
Description: {{DESCRIPTION}}
Tech stack hint: {{TECH_STACK_HINT}}
Success criteria: {{SUCCESS_CRITERIA}}
{{CODEBASE_BLOCK}}

CLARIFICATIONS (Q&A):
{{QA_BLOCK}}`;

function buildCodebaseBlock(mission: MissionContext): string {
  if (!mission.enable_existing_codebase || !mission.codebase_summary) return '';
  return `\nExisting codebase summary:\n${mission.codebase_summary}\n`;
}

function fillTemplate(template: string, mission: MissionContext, qaBlock?: string): string {
  return template
    .replace('{{TITLE}}', mission.title)
    .replace('{{DESCRIPTION}}', mission.description || '(no description provided)')
    .replace('{{TECH_STACK_HINT}}', mission.tech_stack_hint || '(none)')
    .replace('{{SUCCESS_CRITERIA}}', mission.success_criteria || '(none specified)')
    .replace('{{CODEBASE_BLOCK}}', buildCodebaseBlock(mission))
    .replace('{{QA_BLOCK}}', qaBlock || '(none)');
}

// Fallback questions when the gateway can't be reached. These are intentionally
// generic — the UI flow still works end-to-end and the user can answer them
// before subtask generation. Once we wire a working Fury RPC path (Phase 5b),
// this fallback only fires on real gateway outages.
const FALLBACK_QUESTIONS: GeneratedQuestion[] = [
  { category: 'scope', question: 'What is explicitly IN scope for this mission, and what is OUT of scope?' },
  { category: 'success', question: 'What does "done" look like? Any specific tests, metrics, or acceptance criteria?' },
  { category: 'tech', question: 'Are there technical constraints, frameworks, or libraries the team must use (or avoid)?' },
  { category: 'edge_cases', question: 'What edge cases or failure modes worry you the most?' },
  { category: 'integration', question: 'Does this work need to integrate with existing code or systems? If so, where?' },
];

const FALLBACK_SUBTASKS: GeneratedSubtask[] = [
  {
    title: 'Implement core change',
    description: 'Build the primary feature/fix described in the mission. Follow the answered clarifications and respect the success criteria.',
    agent_role: 'builder',
    priority: 4,
    dependencies: [],
  },
  {
    title: 'Add coverage / tests',
    description: 'Write tests covering the new behavior including the edge cases the user flagged.',
    agent_role: 'tester',
    priority: 3,
    dependencies: [0],
  },
  {
    title: 'Review and verify',
    description: 'Review the implementation against the success criteria and confirm tests pass.',
    agent_role: 'reviewer',
    priority: 3,
    dependencies: [0, 1],
  },
];

async function tryCompleteJSON<T>(prompt: string, opts: Parameters<typeof completeJSON>[1]): Promise<{ data: T } | null> {
  try {
    const result = await completeJSON<T>(prompt, opts);
    return { data: result.data };
  } catch (err) {
    console.warn('[planningPipeline] gateway completion failed, falling back to stub:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Calls Fury for clarifying questions and inserts them into planning_questions
 * keyed off the mission's parent_task_id. Returns the inserted rows. If the
 * gateway is unreachable, falls back to a generic question set so the UI flow
 * stays functional.
 */
export async function generateClarifyingQuestions(mission: MissionContext): Promise<Array<{
  id: string;
  question: string;
  category: string;
  sort_order: number;
}>> {
  const prompt = fillTemplate(QUESTION_PROMPT, mission);

  const result = await tryCompleteJSON<{ questions: GeneratedQuestion[] }>(prompt, {
    model: PLANNER_MODEL,
    temperature: 0.4,
    maxTokens: 2000,
  });

  let questions: GeneratedQuestion[];
  if (result?.data && Array.isArray(result.data.questions) && result.data.questions.length > 0) {
    questions = result.data.questions;
  } else {
    questions = FALLBACK_QUESTIONS;
  }
  const data = { questions };
  if (!data || !Array.isArray(data.questions) || data.questions.length === 0) {
    throw new Error('Planner returned no questions');
  }

  const db = getDb();
  const now = new Date().toISOString();
  const inserted: Array<{ id: string; question: string; category: string; sort_order: number }> = [];

  const tx = db.transaction(() => {
    // Replace any prior unanswered questions for this mission to avoid duplicate sets
    db.prepare(`DELETE FROM planning_questions WHERE task_id = ? AND answer IS NULL`).run(mission.parent_task_id);

    const stmt = db.prepare(`
      INSERT INTO planning_questions (id, task_id, category, question, question_type, sort_order, created_at)
      VALUES (?, ?, ?, ?, 'text', ?, ?)
    `);
    data.questions.slice(0, 7).forEach((q, idx) => {
      const id = uuidv4();
      const category = (q.category || 'general').slice(0, 50);
      const question = (q.question || '').trim();
      if (!question) return;
      stmt.run(id, mission.parent_task_id, category, question, idx, now);
      inserted.push({ id, question, category, sort_order: idx });
    });
  });
  tx();

  return inserted;
}

export interface QAPair {
  question: string;
  answer: string;
  category?: string;
}

/**
 * Calls Fury for subtask decomposition. Caller is responsible for inserting
 * the returned subtasks into the tasks + convoy_subtasks tables and
 * advancing the mission stage.
 */
export async function generateSubtasks(mission: MissionContext, qaPairs: QAPair[]): Promise<GeneratedSubtask[]> {
  const qaBlock = qaPairs
    .map((qa, i) => `Q${i + 1} [${qa.category ?? 'general'}]: ${qa.question}\nA${i + 1}: ${qa.answer || '(no answer)'}`)
    .join('\n\n');

  const prompt = fillTemplate(SUBTASK_PROMPT, mission, qaBlock || '(no clarifications)');

  const result = await tryCompleteJSON<{ subtasks: GeneratedSubtask[] }>(prompt, {
    model: PLANNER_MODEL,
    temperature: 0.3,
    maxTokens: 8000,
  });

  let raw: GeneratedSubtask[];
  if (result?.data && Array.isArray(result.data.subtasks) && result.data.subtasks.length > 0) {
    raw = result.data.subtasks;
  } else {
    raw = FALLBACK_SUBTASKS;
  }

  return raw
    .filter(s => s && typeof s.title === 'string' && s.title.trim().length > 0)
    .map(s => ({
      title: s.title.trim().slice(0, 500),
      description: (s.description || '').trim().slice(0, 10_000),
      agent_role: (['planner', 'builder', 'tester', 'reviewer', 'general'] as const).includes(s.agent_role as never)
        ? s.agent_role
        : 'general',
      priority: typeof s.priority === 'number' && s.priority >= 1 && s.priority <= 5 ? s.priority : 3,
      dependencies: Array.isArray(s.dependencies) ? s.dependencies.filter(d => Number.isInteger(d) && d >= 0) : [],
      estimated_hours: typeof s.estimated_hours === 'number' ? s.estimated_hours : undefined,
      files_to_modify: Array.isArray(s.files_to_modify) ? s.files_to_modify.filter(f => typeof f === 'string') : undefined,
    }));
}

/**
 * Translates a Nexus mission priority (1-5) into the existing TaskPriority enum.
 */
export function mapPriority(p?: number): 'low' | 'normal' | 'high' | 'urgent' {
  if (!p) return 'normal';
  if (p >= 5) return 'urgent';
  if (p === 4) return 'high';
  if (p <= 2) return 'low';
  return 'normal';
}
