'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bot } from 'lucide-react';
import { SidebarSection } from './SidebarSection';

interface ActiveSession {
  id: string;
  openclaw_session_id: string;
  agent_id: string | null;
  agent_name?: string;
  agent_avatar_emoji?: string;
  status: string;
  session_type: string;
  created_at: string;
}

const POLL_MS = 10_000;

export function SidebarSessions() {
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/openclaw/sessions?status=active');
      if (res.ok) {
        const data = await res.json();
        setSessions(Array.isArray(data) ? data : []);
      }
    } catch {
      setSessions(prev => prev ?? []);
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
      defaultOpen={false}
    >
      {sessions === null ? (
        <p className="px-2 py-1 text-xs text-mc-text-secondary">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="px-2 py-1 text-xs text-mc-text-secondary">No active sessions</p>
      ) : (
        <ul className="space-y-0.5">
          {sessions.slice(0, 8).map(s => (
            <li
              key={s.id}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-mc-bg-tertiary text-xs"
              title={s.openclaw_session_id}
            >
              <span className="text-base leading-none shrink-0">
                {s.agent_avatar_emoji ?? '🤖'}
              </span>
              <span className="flex-1 min-w-0 truncate text-mc-text">
                {s.agent_name ?? 'Sub-agent'}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-mc-accent-green animate-pulse shrink-0" />
            </li>
          ))}
          {sessions.length > 8 && (
            <li className="px-2 py-0.5 text-[10px] text-mc-text-secondary">
              +{sessions.length - 8} more
            </li>
          )}
        </ul>
      )}
    </SidebarSection>
  );
}
