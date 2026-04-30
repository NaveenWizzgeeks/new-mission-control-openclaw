'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users } from 'lucide-react';
import { SidebarSection } from './SidebarSection';
import type { Agent } from '@/lib/types';
import { useDataRefresh } from '@/hooks/useDataRefresh';

const STATUS_DOT: Record<string, string> = {
  working: 'bg-mc-accent-green',
  standby: 'bg-mc-accent-yellow',
  offline: 'bg-mc-text-secondary',
};

const POLL_MS = 15_000;

export function SidebarAgents() {
  const [agents, setAgents] = useState<Agent[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (res.ok) {
        const data = await res.json();
        setAgents(Array.isArray(data) ? data : []);
      }
    } catch {
      setAgents(prev => prev ?? []);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useDataRefresh(['agents'], load);

  const total = agents?.length ?? 0;
  const working = agents?.filter(a => a.status === 'working').length ?? 0;
  const countLabel = total === 0 ? '0' : `${working}/${total}`;

  return (
    <SidebarSection
      title="Agents"
      storageKey="mc-sidebar-agents-open"
      icon={<Users className="w-3.5 h-3.5" />}
      count={countLabel}
      defaultOpen={true}
    >
      {agents === null ? (
        <p className="px-2 py-1 text-xs text-mc-text-secondary">Loading…</p>
      ) : agents.length === 0 ? (
        <p className="px-2 py-1 text-xs text-mc-text-secondary">No agents</p>
      ) : (
        <ul className="space-y-0.5">
          {agents.slice(0, 10).map(agent => (
            <li
              key={agent.id}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-mc-bg-tertiary text-xs"
              title={`${agent.name} — ${agent.role} (${agent.status})`}
            >
              <span className="text-base leading-none shrink-0">{agent.avatar_emoji}</span>
              <span className="flex-1 min-w-0 truncate text-mc-text">{agent.name}</span>
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  STATUS_DOT[agent.status] ?? 'bg-mc-text-secondary'
                } ${agent.status === 'working' ? 'animate-pulse' : ''}`}
              />
            </li>
          ))}
          {agents.length > 10 && (
            <li className="px-2 py-0.5 text-[10px] text-mc-text-secondary">
              +{agents.length - 10} more
            </li>
          )}
        </ul>
      )}
    </SidebarSection>
  );
}
