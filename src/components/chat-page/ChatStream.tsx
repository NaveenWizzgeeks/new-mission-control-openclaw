'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Loader2, Bot, User, AlertCircle } from 'lucide-react';
import { parseMessage } from './parseMessage';
import { AttachmentChips } from './AttachmentChips';
import { MessageBody } from './ToolUseBlock';
import { parseProposalBlocks } from './parseProposals';
import { ProposalCard } from './ProposalCard';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string | null;
}

interface ChatStreamProps {
  sessionKey: string | null;
  pollIntervalMs?: number;
  agentName?: string;
  /** When set, assistant messages are scanned for Fury proposal JSON blocks
   *  and rendered as inline approval cards that funnel into this mission's
   *  planner_proposed flow. */
  missionId?: string;
  /** Notify parent when subtasks are added — used by the Ask Fury tab to
   *  refresh mission counters. */
  onProposalAccepted?: (count: number) => void;
}

export interface ChatStreamHandle {
  /** Optimistically push the user's outbound message and surface the
   *  "thinking" spinner before the next poll round-trip. The optimistic
   *  bubble is replaced by the canonical one when poll catches up. */
  pushOptimisticUserMessage: (text: string) => void;
}

const DEFAULT_POLL_MS = 2_000;

export const ChatStream = forwardRef<ChatStreamHandle, ChatStreamProps>(function ChatStream(
  { sessionKey, pollIntervalMs = DEFAULT_POLL_MS, agentName, missionId, onProposalAccepted },
  ref,
) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  // Optimistic bubbles: the user just clicked Send and we haven't seen the
  // message in poll history yet. We render them with a faded style and clear
  // them once the canonical text shows up server-side.
  const [optimisticUser, setOptimisticUser] = useState<{ text: string; ts: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    pushOptimisticUserMessage: (text: string) => {
      setOptimisticUser({ text, ts: new Date().toISOString() });
      setIsPending(true);
    },
  }), []);

  const fetchHistory = useCallback(async (signal?: AbortSignal) => {
    if (!sessionKey) {
      setMessages([]);
      return;
    }
    try {
      const url = `/api/openclaw/sessions/history?sessionKey=${encodeURIComponent(sessionKey)}&limit=200`;
      const res = await fetch(url, { signal });
      if (!res.ok) {
        if (res.status === 502) {
          setError('Gateway unreachable');
          return;
        }
        return;
      }
      const data = await res.json();
      const next: Message[] = data.messages || [];
      setMessages(prev => {
        const last = next[next.length - 1];
        // Only show "thinking" while a user message is the most recent thing
        // in real history. Optimistic state is handled separately above.
        setIsPending(!!last && last.role === 'user');
        if (prev && prev.length === next.length && prev[prev.length - 1]?.text === next[next.length - 1]?.text) {
          return prev;
        }
        return next;
      });
      // Reconcile optimistic bubble: once the canonical user message lands
      // in history (matching text), drop the optimistic placeholder.
      setOptimisticUser(prev => {
        if (!prev) return prev;
        const trimmed = prev.text.trim();
        const seen = next.some(m => m.role === 'user' && m.text.trim() === trimmed);
        return seen ? null : prev;
      });
      setError(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }, [sessionKey]);

  useEffect(() => {
    setMessages(null);
    setError(null);
    setIsPending(false);
    setOptimisticUser(null);
  }, [sessionKey]);

  useEffect(() => {
    if (!sessionKey) return;
    const ctrl = new AbortController();
    fetchHistory(ctrl.signal);
    const t = setInterval(() => fetchHistory(ctrl.signal), pollIntervalMs);
    return () => { ctrl.abort(); clearInterval(t); };
  }, [sessionKey, pollIntervalMs, fetchHistory]);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [messages, isPending, optimisticUser]);

  if (!sessionKey) {
    return (
      <div className="flex-1 flex items-center justify-center text-mc-text-secondary text-sm">
        Pick an agent on the right to start a conversation, or click <strong className="mx-1 text-mc-text">New Session</strong> in the left panel.
      </div>
    );
  }
  if (messages === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-mc-text-secondary text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading conversation…
      </div>
    );
  }

  // While thinking + optimistic message is showing, hide the bottom thinking
  // hint duplication (optimistic bubble already implies "waiting").
  const showThinking = isPending || optimisticUser !== null;

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto p-6 space-y-3">
      {error && (
        <div className="flex items-start gap-2 text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {messages.length === 0 && !optimisticUser && (
        <div className="text-mc-text-secondary text-sm text-center py-12">
          No messages yet. Type below to start.
        </div>
      )}

      {messages.map((m, i) => (
        <Bubble
          key={i}
          message={m}
          agentName={agentName}
          missionId={missionId}
          onProposalAccepted={onProposalAccepted}
        />
      ))}

      {optimisticUser && (
        <Bubble
          message={{ role: 'user', text: optimisticUser.text, timestamp: optimisticUser.ts }}
          agentName={agentName}
          pending
        />
      )}

      {showThinking && (
        <div className="flex items-center gap-2 text-xs text-mc-text-secondary pl-10">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{agentName ?? 'Agent'} is thinking…</span>
        </div>
      )}
    </div>
  );
});

interface BubbleProps {
  message: Message;
  agentName?: string;
  /** True when this bubble is an optimistic placeholder pre-server-confirm. */
  pending?: boolean;
  missionId?: string;
  onProposalAccepted?: (count: number) => void;
}

function Bubble({ message, agentName, pending, missionId, onProposalAccepted }: BubbleProps) {
  const isUser = message.role === 'user';
  const parsed = parseMessage(message.text);

  // Only scan assistant messages from a mission-aware ChatStream for
  // proposal JSON blocks. parseProposalBlocks strips the JSON fences from
  // the visible text and returns the parsed specs separately so we can
  // render an approval card instead of dumping raw JSON on the user.
  const proposals = !isUser && missionId
    ? parseProposalBlocks(parsed.text)
    : { cleaned: parsed.text, blocks: [] };

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
          isUser
            ? 'bg-mc-accent-blue/20 text-mc-accent-blue'
            : 'bg-mc-accent-purple/20 text-mc-accent-purple'
        }`}
      >
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 border min-w-0 ${
          isUser
            ? 'bg-mc-accent-blue/5 border-mc-accent-blue/20'
            : 'bg-mc-bg-secondary border-mc-border'
        } ${pending ? 'opacity-60' : ''}`}
      >
        <div className="flex items-center gap-2 mb-1 text-[10px] text-mc-text-secondary">
          <span className="uppercase tracking-wider font-medium">
            {isUser ? 'You' : (agentName ?? 'Assistant')}
          </span>
          {pending && (
            <span className="inline-flex items-center gap-1 text-mc-accent">
              <Loader2 className="w-2.5 h-2.5 animate-spin" /> sending…
            </span>
          )}
          {!pending && message.timestamp && (
            <span className="font-mono">
              {new Date(message.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          )}
        </div>

        <MessageBody text={proposals.cleaned} />
        <AttachmentChips attachments={parsed.attachments} />

        {proposals.blocks.map((block, i) => (
          <ProposalCard
            key={i}
            missionId={missionId!}
            subtasks={block.subtasks}
            onAccepted={onProposalAccepted}
          />
        ))}
      </div>
    </div>
  );
}
