'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, User, Bot } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string | null;
}

interface SessionTranscriptProps { sessionKey: string }

export function SessionTranscript({ sessionKey }: SessionTranscriptProps) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = `/api/openclaw/sessions/history?sessionKey=${encodeURIComponent(sessionKey)}&limit=100`;
        const res = await fetch(url);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || `Load failed (${res.status})`);
          setMessages([]);
        } else {
          setMessages(data.messages || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Load failed');
          setMessages([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [sessionKey]);

  if (messages === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-mc-text-secondary py-3">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading transcript…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-2 text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }
  if (messages.length === 0) {
    return <p className="text-xs text-mc-text-secondary py-3">No assistant or user messages in this session.</p>;
  }

  return (
    <ul className="space-y-2 max-h-96 overflow-y-auto">
      {messages.map((m, i) => {
        const isUser = m.role === 'user';
        return (
          <li key={i} className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
            <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${isUser ? 'bg-mc-accent-blue/20 text-mc-accent-blue' : 'bg-mc-accent-purple/20 text-mc-accent-purple'}`}>
              {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
            </div>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 border ${isUser ? 'bg-mc-accent-blue/5 border-mc-accent-blue/20' : 'bg-mc-bg border-mc-border'}`}>
              <div className="flex items-center gap-2 mb-1 text-[10px] text-mc-text-secondary">
                <span className="uppercase tracking-wider font-medium">{isUser ? 'User' : 'Assistant'}</span>
                {m.timestamp && <span className="font-mono">{new Date(m.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>}
              </div>
              <pre className="text-xs text-mc-text whitespace-pre-wrap break-words font-sans leading-relaxed">{m.text}</pre>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
