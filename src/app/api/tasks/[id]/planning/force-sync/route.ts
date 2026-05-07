import { NextRequest, NextResponse } from 'next/server';
import { getDb, queryOne } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { getMessagesFromOpenClaw, extractJSON } from '@/lib/planning-utils';

export const dynamic = 'force-dynamic';

interface TaskRow {
  id: string;
  status: string;
  planning_session_key: string | null;
  planning_messages: string | null;
  planning_complete: number | null;
  planning_spec: string | null;
}

/**
 * Phase 13Q.2: manual recovery endpoint for stuck planning sessions.
 *
 * The normal /planning/poll route compares assistant message counts and only
 * fetches new content if they differ. In rare edge cases the count appears
 * equal (race conditions, gateway caching) and Fury's latest response never
 * makes it into planning_messages — UI shows nothing new.
 *
 * This endpoint does an UNCONDITIONAL gateway pull, merges anything missing,
 * and if Fury emitted a completion spec, marks the task complete + saves
 * planning_spec. Wire to a "Refresh planning" button in the UI.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  const task = queryOne<TaskRow>(
    `SELECT id, status, planning_session_key, planning_messages, planning_complete, planning_spec
     FROM tasks WHERE id = ?`,
    [taskId],
  );
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  if (!task.planning_session_key) {
    return NextResponse.json({ error: 'Planning not started for this task' }, { status: 400 });
  }

  let gatewayMessages: Array<{ role: string; content: string }>;
  try {
    gatewayMessages = await getMessagesFromOpenClaw(task.planning_session_key);
  } catch (err) {
    return NextResponse.json(
      { error: 'Could not reach gateway', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  const stored = task.planning_messages
    ? (JSON.parse(task.planning_messages) as Array<{ role: string; content: string; timestamp?: number }>)
    : [];

  // Existing assistant texts (string-set, cheap dedupe).
  const existingAssistantTexts = new Set(
    stored.filter(m => m.role === 'assistant').map(m => (m.content ?? '').trim()),
  );

  let added = 0;
  let foundComplete = false;
  let parsedSpec: { status?: string; spec?: object; agents?: unknown; execution_plan?: unknown } | null = null;

  for (const m of gatewayMessages) {
    if (m.role !== 'assistant') continue;
    const text = (m.content ?? '').trim();
    if (existingAssistantTexts.has(text)) continue;
    stored.push({ role: 'assistant', content: text, timestamp: Date.now() });
    added += 1;

    const parsed = extractJSON(text) as { status?: string; spec?: object; agents?: unknown; execution_plan?: unknown } | null;
    if (parsed && parsed.status === 'complete') {
      foundComplete = true;
      parsedSpec = parsed;
    }
  }

  const db = getDb();
  const now = new Date().toISOString();

  if (added === 0 && !task.planning_complete) {
    return NextResponse.json({
      ok: true,
      action: 'noop',
      reason: 'no new assistant messages on gateway',
      stored_count: stored.length,
      gateway_count: gatewayMessages.length,
    });
  }

  // Persist newly-added messages.
  db.prepare(`UPDATE tasks SET planning_messages = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(stored), now, taskId);

  // If we found a completion spec and the task isn't already complete,
  // save it. Don't auto-dispatch (let the user trigger via UI to avoid
  // surprise side effects); they can hit the existing planning UI flow.
  if (foundComplete && !task.planning_complete && parsedSpec) {
    db.prepare(`
      UPDATE tasks SET planning_spec = ?, planning_complete = 1, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(parsedSpec), now, taskId);
  }

  const refreshed = queryOne<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, [taskId]);
  if (refreshed) broadcast({ type: 'task_updated', payload: refreshed as unknown as Record<string, unknown> });

  return NextResponse.json({
    ok: true,
    action: foundComplete ? 'completed' : 'merged',
    added_messages: added,
    stored_count: stored.length,
    gateway_count: gatewayMessages.length,
    complete: foundComplete || !!task.planning_complete,
  });
}
