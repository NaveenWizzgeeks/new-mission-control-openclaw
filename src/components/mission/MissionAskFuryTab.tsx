'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { ChatStream, type ChatStreamHandle } from '@/components/chat-page/ChatStream';
import { ChatComposer, type PendingAttachment } from '@/components/chat-page/ChatComposer';
import type { ParsedCommand } from '@/components/chat-page/ChatComposer';

interface MissionAskFuryTabProps {
  missionId: string;
  missionName: string;
  missionStage: string;
  codebasePath: string | null;
  /** Called after subtasks are accepted from a Fury proposal so the parent
   *  page can refresh mission counters. */
  onProposalAccepted?: (count: number) => void;
}

interface FuryAgent {
  id: string;
  name: string;
  session_key_prefix: string | null;
}

const SUGGESTED_QUESTIONS = [
  'What architecture did you propose for this mission?',
  'Why is subtask 4 blocked?',
  'Should we use Postgres instead of MongoDB?',
  'Summarize what the team has built so far.',
];

/**
 * Persistent Q&A chat with Fury about THIS mission.
 *
 * Session key: `agent:fury:mission-doubts:<missionId>` — separate from the
 * planning session so doubts don't pollute the structured planning context.
 *
 * On first send only, we prepend a small mission-context block so Fury has
 * orientation. Subsequent messages send raw — Fury keeps the conversation
 * thread.
 */
export function MissionAskFuryTab({ missionId, missionName, missionStage, codebasePath, onProposalAccepted }: MissionAskFuryTabProps) {
  const [fury, setFury] = useState<FuryAgent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentOnce, setSentOnce] = useState(false);
  const streamRef = useRef<ChatStreamHandle>(null);

  const sessionKey = `agent:fury:mission-doubts:${missionId}`;

  // Resolve Fury (the lead planner one with session_key_prefix set).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agents');
        if (!res.ok) {
          if (!cancelled) setError(`Could not load agents (${res.status})`);
          return;
        }
        const data = await res.json();
        const list: FuryAgent[] = Array.isArray(data) ? data : (data.agents ?? []);
        const candidate =
          list.find(a => a.name === 'Fury' && a.session_key_prefix === 'agent:fury:') ??
          list.find(a => (a.name ?? '').toLowerCase() === 'fury' && a.session_key_prefix);
        if (cancelled) return;
        if (!candidate) {
          setError('Fury agent not found. Make sure the planner agent is provisioned.');
          return;
        }
        setFury(candidate);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load Fury');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Detect whether this session has any prior messages so we know if the
  // "first message" preamble should still be added.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/openclaw/sessions/history?sessionKey=${encodeURIComponent(sessionKey)}&limit=1`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.messages) && data.messages.length > 0) {
          setSentOnce(true);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [sessionKey]);

  const buildPreamble = useCallback(() => {
    const parts: string[] = [];
    parts.push(`I'm asking about mission **${missionName}** (stage: \`${missionStage}\`).`);
    if (codebasePath) parts.push(`Project path: \`${codebasePath}\`.`);
    parts.push(`This is an open-ended doubt thread — answer concisely; if you propose new subtasks, format them as a JSON spec block so I can approve them.`);
    return parts.join('\n');
  }, [missionName, missionStage, codebasePath]);

  const handleCommand = useCallback(async (cmd: ParsedCommand, attachments: PendingAttachment[]) => {
    if (cmd.kind !== 'send') return;
    const messageText = cmd.message?.trim();
    if (!messageText && attachments.length === 0) return;
    if (!fury) throw new Error('Fury not loaded yet');

    const finalMessage = sentOnce
      ? (messageText ?? '')
      : `${buildPreamble()}\n\n---\n\n${messageText ?? ''}`;

    // Push the optimistic user bubble + thinking spinner *before* the
    // network call so the user sees their message immediately, instead of
    // waiting up to 2s for the next history poll.
    streamRef.current?.pushOptimisticUserMessage(finalMessage);

    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: fury.id,
        sessionKey,
        message: finalMessage,
        attachments: attachments.map(a => ({ name: a.name, mimeType: a.mimeType, data: a.data })),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Send failed (${res.status})`);
    }
    setSentOnce(true);
  }, [fury, sessionKey, sentOnce, buildPreamble]);

  // Programmatic prefill for suggested-question buttons.
  // We can't hand input back to ChatComposer cleanly, so we just send via the
  // same handler as if the user typed it.
  const sendSuggested = useCallback(async (text: string) => {
    if (!fury) return;
    try {
      await handleCommand({ kind: 'send', message: text }, []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    }
  }, [fury, handleCommand]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="flex items-start gap-2 text-sm text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2 max-w-md">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      </div>
    );
  }

  if (!fury) {
    return (
      <div className="flex-1 flex items-center justify-center text-mc-text-secondary text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading Fury…
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-mc-bg">
      {/* Compact header */}
      <div className="px-5 py-3 border-b border-mc-border bg-mc-bg-secondary/40 flex items-start gap-3 shrink-0">
        <div className="w-8 h-8 rounded-full bg-mc-accent/15 text-mc-accent flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-mc-text">Ask Fury about this mission</h3>
          <p className="text-xs text-mc-text-secondary mt-0.5">
            Persistent Q&amp;A thread. Fury has full mission context — design questions,
            follow-ups, debugging.
            {!sentOnce && <span className="ml-1 text-mc-accent">First message will include mission context.</span>}
          </p>
        </div>
      </div>

      {/* Suggested questions — only show before the first send */}
      {!sentOnce && (
        <div className="px-5 py-3 border-b border-mc-border bg-mc-bg-secondary/20">
          <p className="text-[11px] uppercase tracking-wider text-mc-text-secondary mb-2">Try one of these</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map(q => (
              <button
                key={q}
                onClick={() => sendSuggested(q)}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-mc-border bg-mc-bg hover:bg-mc-bg-tertiary hover:border-mc-accent/50 text-mc-text transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <ChatStream
        ref={streamRef}
        sessionKey={sessionKey}
        agentName="Fury"
        missionId={missionId}
        onProposalAccepted={onProposalAccepted}
      />

      <ChatComposer
        agentName="Fury"
        onCommand={handleCommand}
      />
    </div>
  );
}
