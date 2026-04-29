'use client';

import { useCallback, useState, useEffect } from 'react';
import type { Agent } from '@/lib/types';
import { useDataRefresh } from '@/hooks/useDataRefresh';

const STATUS_DOT: Record<string, string> = {
  working: 'bg-mc-accent-green',
  standby: 'bg-mc-accent-yellow',
  offline: 'bg-mc-text-secondary',
};

export function AgentRoster() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch('/api/agents')
      .then(r => r.ok ? r.json() : [])
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useDataRefresh(['agents', 'workspaces'], load);

  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5 flex flex-col max-h-[28rem]">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <p className="text-sm font-medium uppercase tracking-wider text-mc-text-secondary">Agent Roster</p>
        {!loading && agents.length > 0 && (
          <span className="text-xs text-mc-text-secondary tabular-nums">{agents.length}</span>
        )}
      </div>
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-9 rounded-lg bg-mc-bg-tertiary animate-pulse" />)}
        </div>
      ) : agents.length === 0 ? (
        <p className="text-mc-text-secondary text-sm">No agents configured</p>
      ) : (
        <div className="space-y-2 overflow-y-auto -mr-2 pr-2">
          {agents.map(agent => (
            <div key={agent.id} className="flex items-center gap-3">
              <span className="text-xl leading-none">{agent.avatar_emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{agent.name}</p>
                <p className="text-xs text-mc-text-secondary truncate">{agent.role}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${STATUS_DOT[agent.status] ?? 'bg-mc-text-secondary'}`} />
                <span className="text-xs text-mc-text-secondary capitalize">{agent.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
