/**
 * Memory summarizer (Nexus Phase 8).
 *
 * After each OpenClaw session completes we capture the agent's last
 * assistant text as a "memory summary" and store it. At the next dispatch,
 * loadMemoryContext() returns the last N summaries formatted for prompt
 * injection so the agent has continuity across sessions.
 *
 * v1 strategy: literal "last words" summary (extracted from chat.history).
 * No second LLM call. The agent's own end-of-session message is usually a
 * good résumé already (e.g. "Implemented X. Files modified: a.ts, b.ts").
 * A proper Fury-driven summarization can layer on later.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb, queryAll, queryOne, run } from '@/lib/db';
import { getMessagesFromOpenClaw } from '@/lib/planning-utils';

export interface MemorySummary {
  id: string;
  agent_id: string;
  session_id: string | null;
  summary: string;
  token_count: number;
  created_at: string;
}

const MAX_SUMMARY_CHARS = 1500;
const DEFAULT_CONTEXT_LIMIT = 5;
const RECENT_DEDUPE_WINDOW_MIN = 30;

/**
 * Read chat.history for the given session and capture the last assistant
 * message (truncated) as a memory summary for the agent.
 *
 * `sessionKey` is the gateway-side routing key (e.g. `agent:fury:planning:...`).
 * `openclawSessionId` is the row id (UUID stored in `openclaw_sessions.openclaw_session_id`).
 *
 * Idempotent within RECENT_DEDUPE_WINDOW_MIN: if a summary for the same
 * (agent_id, session_id) was created in the last 30 minutes, we skip the
 * insert. This stops repeated session-completion hooks from polluting
 * memory with duplicates.
 */
export async function summarizeFromSession(args: {
  sessionKey: string;
  agentId: string;
  openclawSessionId?: string | null;
}): Promise<{ inserted: boolean; summaryId?: string; reason?: string }> {
  const { sessionKey, agentId, openclawSessionId } = args;

  // Recent dedupe — skip if the same agent already has a summary for this
  // session in the dedupe window.
  if (openclawSessionId) {
    const existing = queryOne<{ id: string }>(
      `SELECT id FROM memory_summaries
       WHERE agent_id = ? AND session_id = ?
         AND created_at > datetime('now', ?)
       LIMIT 1`,
      [agentId, openclawSessionId, `-${RECENT_DEDUPE_WINDOW_MIN} minutes`]
    );
    if (existing) return { inserted: false, reason: 'recent_duplicate' };
  }

  let assistantMessages: Array<{ role: string; content: string }> = [];
  try {
    assistantMessages = await getMessagesFromOpenClaw(sessionKey);
  } catch (err) {
    return { inserted: false, reason: `chat_history_failed: ${err instanceof Error ? err.message : err}` };
  }

  // getMessagesFromOpenClaw filters to assistant text already; take the last.
  const last = assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1] : null;
  if (!last || !last.content || last.content.trim().length === 0) {
    return { inserted: false, reason: 'no_assistant_text' };
  }

  // Truncate to keep memory entries snappy. We slice from the END so the
  // summary captures the agent's final conclusions / hand-off note rather
  // than its opening pleasantries.
  const trimmed = last.content.trim();
  const summary = trimmed.length > MAX_SUMMARY_CHARS
    ? '…' + trimmed.slice(-MAX_SUMMARY_CHARS)
    : trimmed;

  const tokenCount = approxTokens(summary);
  const id = uuidv4();
  run(
    `INSERT INTO memory_summaries (id, agent_id, session_id, summary, token_count, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [id, agentId, openclawSessionId ?? null, summary, tokenCount]
  );
  return { inserted: true, summaryId: id };
}

/**
 * Manual store path — call when you already have the summary text (e.g.
 * from a Fury-driven summarization or an external tool).
 */
export function storeMemory(args: {
  agentId: string;
  sessionId?: string | null;
  summary: string;
  tokenCount?: number;
}): MemorySummary {
  const id = uuidv4();
  const summary = args.summary.length > MAX_SUMMARY_CHARS
    ? '…' + args.summary.slice(-MAX_SUMMARY_CHARS)
    : args.summary;
  const tokenCount = args.tokenCount ?? approxTokens(summary);
  run(
    `INSERT INTO memory_summaries (id, agent_id, session_id, summary, token_count, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [id, args.agentId, args.sessionId ?? null, summary, tokenCount]
  );
  return { id, agent_id: args.agentId, session_id: args.sessionId ?? null, summary, token_count: tokenCount, created_at: new Date().toISOString() };
}

/**
 * Format the last N summaries for prompt injection. Empty string when the
 * agent has no memory yet (so the dispatch path can no-op cleanly).
 */
export function loadMemoryContext(agentId: string, limit: number = DEFAULT_CONTEXT_LIMIT): string {
  const rows = queryAll<{ summary: string; created_at: string }>(
    `SELECT summary, created_at FROM memory_summaries
     WHERE agent_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [agentId, limit]
  );
  if (rows.length === 0) return '';

  const formatted = rows
    .map(r => {
      const date = r.created_at.split('T')[0] || r.created_at.slice(0, 10);
      // Tighten any double-newlines in the summary to keep the block compact
      const compact = r.summary.replace(/\n{3,}/g, '\n\n').trim();
      return `[${date}] ${compact}`;
    })
    .join('\n\n---\n\n');

  return `\n\n---\n\n## Previous Session Context\n\n${formatted}\n`;
}

/**
 * Approximate token count from char count. ~4 chars/token for English-ish.
 * Keeps us in the right order of magnitude without pulling in tiktoken.
 */
function approxTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function getMemoryForAgent(agentId: string, limit: number = 50): MemorySummary[] {
  return queryAll<MemorySummary>(
    `SELECT id, agent_id, session_id, summary, token_count, created_at
     FROM memory_summaries
     WHERE agent_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [agentId, limit]
  );
}

export function clearMemoryForAgent(agentId: string): { deleted: number } {
  const db = getDb();
  const result = db.prepare(`DELETE FROM memory_summaries WHERE agent_id = ?`).run(agentId);
  return { deleted: result.changes };
}
