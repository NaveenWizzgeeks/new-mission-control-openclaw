'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Bot, User, Wrench, AlertCircle } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string | null;
}

interface ChatStreamProps {
  sessionKey: string | null;
  pollIntervalMs?: number;
  agentName?: string;
}

const DEFAULT_POLL_MS = 2_000;

export function ChatStream({ sessionKey, pollIntervalMs = DEFAULT_POLL_MS, agentName }: ChatStreamProps) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
        // Detect if assistant is "thinking" — last message is user with no
        // following assistant. Heuristic for the spinner placement.
        const last = next[next.length - 1];
        setIsPending(!!last && last.role === 'user');
        // No-op when nothing changed (ref equality on length + last text)
        if (prev && prev.length === next.length && prev[prev.length - 1]?.text === next[next.length - 1]?.text) {
          return prev;
        }
        return next;
      });
      setError(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }, [sessionKey]);

  // Reset on session change
  useEffect(() => {
    setMessages(null);
    setError(null);
    setIsPending(false);
  }, [sessionKey]);

  // Poll
  useEffect(() => {
    if (!sessionKey) return;
    const ctrl = new AbortController();
    fetchHistory(ctrl.signal);
    const t = setInterval(() => fetchHistory(ctrl.signal), pollIntervalMs);
    return () => { ctrl.abort(); clearInterval(t); };
  }, [sessionKey, pollIntervalMs, fetchHistory]);

  // Auto-scroll on new content
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [messages, isPending]);

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

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto p-6 space-y-3">
      {error && (
        <div className="flex items-start gap-2 text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {messages.length === 0 && (
        <div className="text-mc-text-secondary text-sm text-center py-12">
          No messages yet. Type below to start.
        </div>
      )}

      {messages.map((m, i) => <Bubble key={i} message={m} agentName={agentName} />)}

      {isPending && (
        <div className="flex items-center gap-2 text-xs text-mc-text-secondary pl-10">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{agentName ?? 'Agent'} is thinking…</span>
        </div>
      )}
    </div>
  );
}

function Bubble({ message, agentName }: { message: Message; agentName?: string }) {
  const isUser = message.role === 'user';
  const text = useMemo(() => prettyJson(message.text), [message.text]);

  // Detect tool-call patterns in assistant output. Since we don't have
  // structured tool blocks (the gateway returns text only), we look for
  // common "Used: X" / "Tool:" prefixes.
  const isToolCall = !isUser && /^\s*(?:🔧|Tool:|Used:)/.test(text);

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${isUser ? 'bg-mc-accent-blue/20 text-mc-accent-blue' : 'bg-mc-accent-purple/20 text-mc-accent-purple'}`}>
        {isUser ? <User className="w-3.5 h-3.5" /> : (isToolCall ? <Wrench className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />)}
      </div>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 border ${isUser ? 'bg-mc-accent-blue/5 border-mc-accent-blue/20' : 'bg-mc-bg-secondary border-mc-border'}`}>
        <div className="flex items-center gap-2 mb-1 text-[10px] text-mc-text-secondary">
          <span className="uppercase tracking-wider font-medium">{isUser ? 'You' : (agentName ?? 'Assistant')}</span>
          {message.timestamp && <span className="font-mono">{new Date(message.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>}
        </div>
        <pre className="text-xs text-mc-text whitespace-pre-wrap break-words font-sans leading-relaxed">{text}</pre>
      </div>
    </div>
  );
}

// If the assistant emitted a JSON object (planning protocol etc), pretty-print.
function prettyJson(text: string): string {
  const t = text.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { return JSON.stringify(JSON.parse(t), null, 2); } catch { /* fallthrough */ }
  }
  return text;
}
