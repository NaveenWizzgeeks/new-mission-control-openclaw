'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bot } from 'lucide-react';
import { SidebarSection } from './SidebarSection';

interface GatewaySession {
  key: string;
  sessionId: string;
  status?: string;
  model?: string;
  modelProvider?: string;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  updatedAt?: number;
  abortedLastRun?: boolean;
  endedAt?: number;
}

const POLL_MS = 10_000;

function formatNum(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function shortenKey(key: string): string {
  // agent:jarvis:main → jarvis · main
  // agent:stark:subagent:5f5f7a58-... → stark · subagent
  // agent:main:mission-control-reviewer-agent-XXXX → mission-control reviewer
  const parts = key.split(':');
  if (parts[0] !== 'agent') return key;
  const name = parts[1];
  const role = parts[2];
  if (!role || role === 'main') return name;
  if (role === 'subagent') return `${name} · subagent`;
  // strip trailing UUID-ish suffix from mission-control-* keys
  const cleaned = role.replace(/-(?:[a-f0-9]{6,}|\d+).*$/i, '');
  return cleaned || role;
}

function isLive(s: GatewaySession): boolean {
  return !s.endedAt && s.status !== 'ended' && s.status !== 'closed';
}

export function SidebarSessions() {
  const [sessions, setSessions] = useState<GatewaySession[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/openclaw/sessions');
      if (res.ok) {
        const data = await res.json();
        // Gateway shape: { sessions: { sessions: [...], count, ts } }
        // Tolerate a flat array too.
        const wrapper = data?.sessions;
        const list: GatewaySession[] = Array.isArray(wrapper?.sessions)
          ? wrapper.sessions
          : Array.isArray(wrapper)
          ? wrapper
          : Array.isArray(data)
          ? data
          : [];
        // Most-recently active first
        list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        setSessions(list);
        setUnavailable(false);
      } else if (res.status === 503) {
        setUnavailable(true);
      }
    } catch {
      setUnavailable(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const total = sessions?.length ?? 0;
  const liveCount = sessions?.filter(isLive).length ?? 0;
  const countLabel = total === 0 ? '0' : `${liveCount}/${total}`;

  return (
    <SidebarSection
      title="Sessions"
      storageKey="mc-sidebar-sessions-open"
      icon={<Bot className="w-3.5 h-3.5" />}
      count={countLabel}
      defaultOpen={true}
    >
      {unavailable ? (
        <p className="px-2 py-1 text-xs text-mc-text-secondary">Gateway offline</p>
      ) : sessions === null ? (
        <p className="px-2 py-1 text-xs text-mc-text-secondary">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="px-2 py-1 text-xs text-mc-text-secondary">No sessions</p>
      ) : (
        <ul className="space-y-0.5">
          {sessions.slice(0, 10).map(s => {
            const live = isLive(s);
            return (
              <li
                key={s.sessionId || s.key}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-mc-bg-tertiary text-xs"
                title={`${s.key}\n${s.model ?? ''}\n${formatNum(s.totalTokens ?? 0)} tokens`}
              >
                <span className="text-base leading-none shrink-0">🤖</span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-mc-text">{shortenKey(s.key)}</p>
                  <p className="truncate text-[10px] text-mc-text-secondary font-mono">
                    {formatNum(s.totalTokens ?? 0)} tok
                    {s.model ? ` · ${s.model.replace(/^claude-/, '')}` : ''}
                  </p>
                </div>
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    live ? 'bg-mc-accent-green animate-pulse' : 'bg-mc-text-secondary'
                  }`}
                />
              </li>
            );
          })}
          {sessions.length > 10 && (
            <li className="px-2 py-0.5 text-[10px] text-mc-text-secondary">
              +{sessions.length - 10} more
            </li>
          )}
        </ul>
      )}
    </SidebarSection>
  );
}
