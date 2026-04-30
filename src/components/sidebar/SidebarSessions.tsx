'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bot } from 'lucide-react';
import { SidebarSection } from './SidebarSection';

interface GatewaySession {
  id: string;
  channel: string;
  peer?: string;
  model?: string;
  status: string;
}

const POLL_MS = 10_000;

export function SidebarSessions() {
  const [sessions, setSessions] = useState<GatewaySession[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      // No filter params → /api/openclaw/sessions hits the OpenClaw gateway
      // (with status/session_type filter it would query the local DB instead)
      const res = await fetch('/api/openclaw/sessions');
      if (res.ok) {
        const data = await res.json();
        const list: GatewaySession[] = Array.isArray(data?.sessions) ? data.sessions : [];
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

  const count = sessions?.length ?? 0;

  return (
    <SidebarSection
      title="Sessions"
      storageKey="mc-sidebar-sessions-open"
      icon={<Bot className="w-3.5 h-3.5" />}
      count={count}
      defaultOpen={true}
    >
      {unavailable ? (
        <p className="px-2 py-1 text-xs text-mc-text-secondary">Gateway offline</p>
      ) : sessions === null ? (
        <p className="px-2 py-1 text-xs text-mc-text-secondary">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="px-2 py-1 text-xs text-mc-text-secondary">No active sessions</p>
      ) : (
        <ul className="space-y-0.5">
          {sessions.slice(0, 10).map(s => (
            <li
              key={s.id}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-mc-bg-tertiary text-xs"
              title={`${s.id}\nchannel: ${s.channel}${s.peer ? `\npeer: ${s.peer}` : ''}${s.model ? `\nmodel: ${s.model}` : ''}`}
            >
              <span className="text-base leading-none shrink-0">🤖</span>
              <div className="flex-1 min-w-0">
                <p className="truncate text-mc-text">{s.peer ?? s.channel}</p>
                {s.model && (
                  <p className="truncate text-[10px] text-mc-text-secondary font-mono">{s.model}</p>
                )}
              </div>
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  s.status === 'active' || s.status === 'open'
                    ? 'bg-mc-accent-green animate-pulse'
                    : 'bg-mc-text-secondary'
                }`}
              />
            </li>
          ))}
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
