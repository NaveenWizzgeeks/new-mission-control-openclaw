/**
 * Fury Planner — drives mission planning via OpenClaw `chat.send` / `chat.history`
 * (the same RPC pattern autensa uses for task planning in
 * src/app/api/tasks/[id]/planning/route.ts).
 *
 * Why not /v1/chat/completions: this gateway version doesn't expose the OpenAI
 * REST endpoint. WebSocket JSON-RPC `chat.send` + `chat.history` is the
 * supported path.
 *
 * Flow:
 *   1. ensureFurySessionPrefix() — guarantees Fury has session_key_prefix='agent:fury:'
 *   2. kickoffMissionPlanning() — sends the protocol + mission context to Fury
 *   3. readFurySessionMessages() — pulls latest assistant messages
 *   4. parseQuestionOrSpec() — discriminates a question payload from a
 *      `status:'complete'` spec payload
 */

import { v4 as uuidv4 } from 'uuid';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { getDb } from '@/lib/db';
import { extractJSON, getMessagesFromOpenClaw } from '@/lib/planning-utils';

const FURY_SESSION_PREFIX = 'agent:fury:';
const PLANNING_SUBPREFIX = 'mission-planning:';

export interface MissionPromptContext {
  id: string;
  parent_task_id: string;
  title: string;
  description: string;
  tech_stack_hint?: string | null;
  success_criteria?: string | null;
  codebase_summary?: string | null;
  enable_existing_codebase?: boolean;
}

export interface ParsedQuestion {
  question: string;
  options: Array<{ id: string; label: string }>;
  category?: string;
}

export interface ParsedSpec {
  status: 'complete';
  spec?: { subtasks?: GeneratedSubtaskShape[] } | unknown;
  subtasks?: GeneratedSubtaskShape[];
}

export interface GeneratedSubtaskShape {
  title: string;
  description?: string;
  agent_role?: 'planner' | 'builder' | 'tester' | 'reviewer' | 'general';
  priority?: number;
  dependencies?: number[];
  files_to_modify?: string[];
  /** Phase 13L Fix 4: Fury can mark a subtask as needing its own planning chat
   *  before execution. The subtask is created in 'planning' status and waits
   *  for the user (or the agent) to flip it to 'inbox'. */
  needs_planning?: boolean;
}

/**
 * Returns the deterministic session key for a given mission's planning chat.
 * Must match between kickoff and subsequent answer/poll calls.
 */
export function getMissionPlanningSessionKey(missionId: string): string {
  return `${FURY_SESSION_PREFIX}${PLANNING_SUBPREFIX}${missionId}`;
}

/**
 * Look up Fury (the lead planner) and ensure her session_key_prefix is set so
 * the gateway routes our chat.send messages back to her. Returns the agent row.
 */
export function ensureFurySessionPrefix(): { id: string; name: string; session_key_prefix: string } {
  const db = getDb();
  // Prefer the lead agent if one exists; otherwise the first planner-role global agent.
  const fury = (db.prepare(`
    SELECT id, name, session_key_prefix
    FROM agents
    WHERE (is_lead = 1 OR LOWER(role) = 'planner')
    ORDER BY is_lead DESC, is_global DESC, created_at ASC
    LIMIT 1
  `).get() as { id: string; name: string; session_key_prefix: string | null } | undefined);

  if (!fury) {
    throw new Error('No planner/lead agent configured. Cannot start mission planning.');
  }

  if (!fury.session_key_prefix) {
    db.prepare(`UPDATE agents SET session_key_prefix = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(FURY_SESSION_PREFIX, fury.id);
    return { id: fury.id, name: fury.name, session_key_prefix: FURY_SESSION_PREFIX };
  }

  return { id: fury.id, name: fury.name, session_key_prefix: fury.session_key_prefix };
}

const MISSION_PROTOCOL = `MISSION PLANNING PROTOCOL

You are Fury, the planner. You will conduct a clarifying-question conversation
about a mission, then produce a structured subtask plan.

Phase A — clarifying questions
- Ask ONE question at a time. The user answers; THEN you ask the next.
- Each question is multiple choice with EXACTLY 4 options:
    Three concrete, mission-specific options you propose, AND a final "Other"
    option labelled exactly "Other" with id "other" so the user can free-type.
- Skip any question whose answer is already obvious from the mission text.
- Aim for 3 to 5 questions total. Stop sooner if the mission is unambiguous.

Phase B — final spec
- After enough clarification, emit a single JSON object with status:'complete'
  and a subtasks list. Tasks run sequentially by default; use "dependencies"
  (array of indices into your subtasks list) only when one task strictly needs
  another to be done first.
- Choose agent_role from: planner | builder | tester | reviewer | general.

Output format
- ALWAYS respond with ONLY one valid JSON object — no prose, no markdown.
- Question payload:
    {
      "category": "scope|tech|constraints|edge_cases|success|integration",
      "question": "Your question?",
      "options": [
        {"id":"A","label":"..."},
        {"id":"B","label":"..."},
        {"id":"C","label":"..."},
        {"id":"other","label":"Other"}
      ]
    }
- Final spec payload (use ONLY when you've heard enough):
    {
      "status":"complete",
      "subtasks":[
        {
          "title":"...",
          "description":"...",
          "agent_role":"builder",
          "priority":3,
          "dependencies":[],
          "files_to_modify":[]
        }
      ]
    }`;

function buildKickoffPrompt(mission: MissionPromptContext): string {
  const codebaseBlock = mission.enable_existing_codebase && mission.codebase_summary
    ? `\nExisting codebase summary:\n${mission.codebase_summary}\n`
    : '';

  return `${MISSION_PROTOCOL}

MISSION
Title: ${mission.title}
Description: ${mission.description || '(no description)'}
Tech stack hint: ${mission.tech_stack_hint || '(none)'}
Success criteria: ${mission.success_criteria || '(none specified)'}
${codebaseBlock}
Begin with your FIRST clarifying question now. Reply with ONLY the JSON.`;
}

/**
 * Sends the initial planning prompt to Fury. Throws if the gateway is
 * unreachable so the route can surface a 502 to the UI rather than fabricate
 * a question set.
 */
export async function kickoffMissionPlanning(mission: MissionPromptContext): Promise<{
  sessionKey: string;
  agentId: string;
}> {
  const fury = ensureFurySessionPrefix();
  const sessionKey = getMissionPlanningSessionKey(mission.id);
  const message = buildKickoffPrompt(mission);

  const client = getOpenClawClient();
  if (!client.isConnected()) {
    await client.connect();
  }

  await client.call('chat.send', {
    sessionKey,
    message,
    idempotencyKey: `mission-plan-start-${mission.id}-${Date.now()}`,
  });

  return { sessionKey, agentId: fury.id };
}

/**
 * Sends a user answer back into the same Fury session. Format mirrors the
 * autensa task planning ("USER ANSWER:" prefix) so the agent sees clearly
 * which message is the answer to its last question.
 */
export async function sendAnswerToFury(sessionKey: string, question: string, answerText: string): Promise<void> {
  const client = getOpenClawClient();
  if (!client.isConnected()) {
    await client.connect();
  }
  const message = `USER ANSWER to "${question.slice(0, 200)}"\n\n${answerText.trim()}\n\nNow ask the next clarifying question, OR if you have enough clarity emit the final spec per the protocol. Reply with ONLY one JSON object.`;
  await client.call('chat.send', {
    sessionKey,
    message,
    idempotencyKey: `mission-plan-answer-${uuidv4()}`,
  });
}

export interface FuryMessage {
  role: string;
  content: string;
}

export async function readFurySessionMessages(sessionKey: string): Promise<FuryMessage[]> {
  return getMessagesFromOpenClaw(sessionKey);
}

/**
 * Type-narrowing parse. Returns either a question payload, a final-spec
 * payload, or null when the message can't be parsed as our JSON contract.
 */
export function parseQuestionOrSpec(content: string): ParsedQuestion | ParsedSpec | null {
  const parsed = extractJSON(content);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  if (obj.status === 'complete') {
    const subtasks = Array.isArray((obj.spec as { subtasks?: unknown })?.subtasks)
      ? (obj.spec as { subtasks?: GeneratedSubtaskShape[] }).subtasks
      : Array.isArray(obj.subtasks)
      ? (obj.subtasks as GeneratedSubtaskShape[])
      : [];
    return { status: 'complete', spec: obj.spec, subtasks };
  }

  if (typeof obj.question === 'string' && Array.isArray(obj.options)) {
    const options = (obj.options as Array<Record<string, unknown>>)
      .filter(o => typeof o.id === 'string' && typeof o.label === 'string')
      .map(o => ({ id: o.id as string, label: o.label as string }));
    if (options.length >= 2) {
      return {
        question: obj.question as string,
        options,
        category: typeof obj.category === 'string' ? obj.category : 'general',
      };
    }
  }

  return null;
}
