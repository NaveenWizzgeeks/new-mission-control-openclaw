/**
 * Chat Listener — captures agent responses to user chat messages and
 * dispatch deliveries.
 *
 * Strategy: tracks which sessionKeys have pending sends. When a state=final
 * chat_event arrives on a tracked session, stores it as the agent's reply
 * (for chat) or just clears the watchdog (for dispatch). On timeout without
 * any reply, writes a visible error onto the task so the card surfaces it
 * instead of spinning silently. This is what catches gateway LLM failures
 * (quota, unknown model, rate-limit) since the gateway accepts the chat.send
 * but never produces a chat_event.
 */
import { getOpenClawClient } from '@/lib/openclaw/client';
import { queryOne, queryAll, run } from '@/lib/db';
import { createNote } from '@/lib/task-notes';
import { broadcast } from '@/lib/events';
import type { OpenClawSession, Task } from '@/lib/types';

const GLOBAL_LISTENER_KEY = '__chat_listener_attached__';

type PendingKind = 'chat' | 'dispatch';
interface PendingEntry { taskId: string; sentAt: number; kind: PendingKind }

// Sessions awaiting a reply
const PENDING_KEY = '__chat_pending_replies__';
if (!(PENDING_KEY in globalThis)) {
  (globalThis as Record<string, unknown>)[PENDING_KEY] = new Map<string, PendingEntry>();
}
const pendingReplies = (globalThis as unknown as Record<string, Map<string, PendingEntry>>)[PENDING_KEY];

// Phase 13S.4 / 13S.12 / 13S.13: timeouts.
// - Chat (user waiting in the chat panel) → 90s, since the user can see the
//   thread and a stall is annoying.
// - Dispatch: NO time-based notice. Builder/tester runs legitimately take
//   many minutes to produce their first output, and a time-based watchdog
//   produced too many false positives. We still react to real gateway
//   error events; for genuinely stuck sessions the user can sync or
//   re-dispatch from the task detail page.
const CHAT_TIMEOUT_MS = 90_000;

interface ChatEventPayload {
  runId?: string;
  sessionKey?: string;
  seq?: number;
  state?: string;
  message?: string | { role?: string; content?: unknown };
  error?: string | { message?: string };
}

function setPending(sessionKey: string, taskId: string, kind: PendingKind, timeoutMs?: number): void {
  pendingReplies.set(sessionKey, { taskId, sentAt: Date.now(), kind });
  // Only chat sends arm a timeout; dispatch waits indefinitely (real gateway
  // errors are surfaced via the chat_event 'error' state instead).
  if (timeoutMs && timeoutMs > 0) {
    setTimeout(() => onPendingTimeout(sessionKey, timeoutMs), timeoutMs);
  }
}

function onPendingTimeout(sessionKey: string, timeoutMs: number): void {
  const entry = pendingReplies.get(sessionKey);
  if (!entry) return;
  if (Date.now() - entry.sentAt < timeoutMs) return; // raced with a fresh send
  if (entry.kind === 'dispatch') return; // dispatches no longer time out
  pendingReplies.delete(sessionKey);

  // For interactive chat, write a note the user can see in the chat tab.
  try {
    createNote(entry.taskId, `_(no reply from agent within ${Math.round(timeoutMs / 1000)}s — gateway may be unavailable or out of LLM quota)_`, 'note', 'assistant');
    broadcast({ type: 'note_delivered', payload: { taskId: entry.taskId } });
  } catch (err) {
    console.error('[ChatListener] Failed to record chat-timeout note:', err);
  }
}

function surfaceTaskError(taskId: string, message: string): void {
  try {
    const now = new Date().toISOString();
    run(
      `UPDATE tasks SET planning_dispatch_error = ?, updated_at = ? WHERE id = ? AND status NOT IN ('done','review')`,
      [message, now, taskId]
    );
    const updated = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (updated) broadcast({ type: 'task_updated', payload: updated });
    console.warn(`[ChatListener] Surfaced gateway error on task ${taskId}: ${message}`);
  } catch (err) {
    console.error('[ChatListener] Failed to surface task error:', err);
  }
}

/**
 * Mark a session as expecting a chat reply from the agent.
 * Called by the chat route after sending a user-typed message.
 */
export function expectReply(sessionKey: string, taskId: string): void {
  setPending(sessionKey, taskId, 'chat', CHAT_TIMEOUT_MS);
}

/**
 * Mark a session as expecting a dispatch acknowledgement (any chat_event
 * for the session). Called by the dispatch route after chat.send succeeds.
 * No timeout — gateway errors are still surfaced via chat_event state==='error'.
 */
export function expectDispatchReply(sessionKey: string, taskId: string): void {
  setPending(sessionKey, taskId, 'dispatch');
}

function extractContent(message: ChatEventPayload['message']): string {
  if (typeof message === 'string') return message;
  if (!message || typeof message !== 'object') return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return (message.content as Array<{ type?: string; text?: string }>)
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text!)
      .join('\n');
  }
  return '';
}

export function attachChatListener(): void {
  if ((globalThis as Record<string, unknown>)[GLOBAL_LISTENER_KEY]) return;
  (globalThis as Record<string, unknown>)[GLOBAL_LISTENER_KEY] = true;

  const client = getOpenClawClient();

  client.on('chat_event', (payload: ChatEventPayload) => {
    if (!payload.sessionKey) return;

    const pending = pendingReplies.get(payload.sessionKey);
    if (!pending) return;

    // Phase 13S.4: react to gateway error states (some gateways emit one,
    // some don't — we honour it when present so dispatches don't sit waiting
    // for the watchdog timeout).
    if (payload.state === 'error') {
      const errMsg = typeof payload.error === 'string'
        ? payload.error
        : payload.error?.message || 'Gateway reported an error with no message';
      pendingReplies.delete(payload.sessionKey);
      surfaceTaskError(pending.taskId, `Gateway error: ${errMsg}`);
      return;
    }

    // Only process final (complete) messages from here on
    if (payload.state !== 'final') return;

    // Dispatch acknowledgements clear the watchdog but never write a note —
    // the dispatch flow has its own status updates (TASK_COMPLETE: parsing,
    // PATCH /api/tasks/[id]). Surfacing the agent's first reply as a note
    // would duplicate every dispatched task into chat history.
    if (pending.kind === 'dispatch') {
      pendingReplies.delete(payload.sessionKey);
      // Clear any prior dispatch_error since the agent did respond.
      run('UPDATE tasks SET planning_dispatch_error = NULL WHERE id = ? AND planning_dispatch_error IS NOT NULL', [pending.taskId]);
      return;
    }

    const content = extractContent(payload.message);
    if (!content.trim()) return;

    // Skip dispatch-template content that leaks through
    if (content.includes('NEW TASK ASSIGNED') || content.includes('OUTPUT DIRECTORY:') ||
        content.includes('TASK_COMPLETE:') || content.includes('TEST_PASS:') ||
        content.includes('VERIFY_PASS:')) return;

    pendingReplies.delete(payload.sessionKey);

    try {
      console.log(`[ChatListener] Agent replied for task ${pending.taskId}: ${content.slice(0, 100)}...`);
      const note = createNote(pending.taskId, content.trim(), 'direct', 'assistant');
      broadcast({ type: 'note_delivered', payload: { taskId: pending.taskId, noteId: note.id } });
    } catch (err) {
      console.error('[ChatListener] Failed to store agent response:', err);
    }

    // Phase 13f: scan outbound (agent→user) text for leaked secrets and
    // dangerous tool patterns. Fire-and-forget; never crash the listener.
    void (async () => {
      try {
        const taskRow = queryOne<{ assigned_agent_id: string | null }>(
          `SELECT assigned_agent_id FROM tasks WHERE id = ?`,
          [pending.taskId],
        );
        const { scanOutbound } = await import('@/lib/security/scanner');
        const { recordFindings } = await import('@/lib/security/store');
        const findings = scanOutbound(content);
        if (findings.length > 0) {
          recordFindings(findings, {
            agentId: taskRow?.assigned_agent_id ?? undefined,
            sessionId: payload.sessionKey,
            source: 'chat_outbound',
          });
        }
      } catch (err) {
        console.error('[ChatListener] outbound security scan failed:', err);
      }
    })();

    // Phase 13O.4 / 13S.5: a 'final' event means the agent has produced its
    // final message — but autensa relied on a TASK_COMPLETE: sentinel that
    // the model often forgot to emit. Schedule a sync-from-gateway shortly
    // after to mark the session done; 6s gives the gateway enough headroom
    // to settle without making the next subtask wait too long.
    setTimeout(() => {
      void (async () => {
        try {
          const { getMissionControlUrl } = await import('@/lib/config');
          const base = getMissionControlUrl();
          await fetch(`${base}/api/tasks/${pending.taskId}/sync-from-gateway`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            signal: AbortSignal.timeout(15_000),
          }).catch(() => { /* best-effort */ });
        } catch (err) {
          console.error('[ChatListener] auto-sync after final failed:', err);
        }
      })();
    }, 6_000);
  });

  console.log('[ChatListener] Attached to OpenClaw client');
}
