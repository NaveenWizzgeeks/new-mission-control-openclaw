'use client';

import { useState, useEffect } from 'react';
import type { Agent } from '@/lib/types';

const STATUS_DOT: Record<string, string> = {
  working: 'bg-mc-accent-green',
  standby: 'bg-mc-accent-yellow',
  offline: 'bg-mc-text-secondary',
};

export function AgentRoster() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.ok ? r.json() : [])
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
      <p className="text-sm font-medium uppercase tracking-wider text-mc-text-secondary mb-4">Agent Roster</p>
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-9 rounded-lg bg-mc-bg-tertiary animate-pulse" />)}
        </div>
      ) : agents.length === 0 ? (
        <p className="text-mc-text-secondary text-sm">No agents configured</p>
      ) : (
        <div className="space-y-2">
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
