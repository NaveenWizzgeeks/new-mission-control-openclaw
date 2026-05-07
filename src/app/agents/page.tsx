'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Crown, Bot, Loader2, MoreVertical, Settings as SettingsIcon, MessageSquare, ChevronRight } from 'lucide-react';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import type { Agent } from '@/lib/types';

interface AgentRow extends Agent {
  is_lead?: boolean;
  is_global?: boolean;
}

interface SkillCount { agent_id: string; n: number }

const STATUS_DOT: Record<string, string> = {
  working: 'bg-mc-accent-green',
  standby: 'bg-mc-accent-yellow',
  offline: 'bg-mc-text-secondary',
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [skillCounts, setSkillCounts] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (!res.ok) {
        setAgents([]);
        return;
      }
      const data: AgentRow[] = await res.json();
      setAgents(data);

      // Fetch skill counts in parallel (skips 404s gracefully)
      const counts: Record<string, number> = {};
      await Promise.all(data.map(async a => {
        try {
          const r = await fetch(`/api/skills?agent_id=${a.id}`);
          if (r.ok) {
            const list = await r.json();
            counts[a.id] = Array.isArray(list) ? list.length : 0;
          }
        } catch { /* skip */ }
      }));
      setSkillCounts(counts);
    } catch (err) {
      console.error('[AgentsPage] load failed:', err);
      setAgents([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useDataRefresh(['agents'], load);

  // SSE: agent_health_changed bumps after Set as Lead — refresh
  useEffect(() => {
    const onAgentChange = () => load();
    window.addEventListener('mc:agent_health_changed', onAgentChange);
    return () => window.removeEventListener('mc:agent_health_changed', onAgentChange);
  }, [load]);

  const setAsLead = async (agentId: string) => {
    setBusyId(agentId);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/set-lead`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed (${res.status})`);
      } else {
        await load();
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold mb-1 flex items-center gap-2">
              <Bot className="w-5 h-5 text-mc-accent" /> Agents
            </h2>
            <p className="text-sm text-mc-text-secondary">
              Global agent pool. Skills follow each agent into every mission. The Lead Agent
              coordinates the team.
            </p>
          </div>
          <Link
            href="/agents/discover-local"
            className="text-xs text-mc-text-secondary hover:text-mc-text border border-mc-border rounded-md px-2 py-1 hover:bg-mc-bg-tertiary"
            title="Scan ~/.claude/agents, ~/.codex/agents, ~/.agents/, ~/.openclaw/agents"
          >
            Discover local &rsaquo;
          </Link>
          <Link
            href="/settings#agents"
            className="text-xs text-mc-text-secondary hover:text-mc-text"
            title="Manage agent provisioning in Settings"
          >
            Settings &rsaquo;
          </Link>
        </div>

        {error && (
          <div className="text-sm text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {agents === null ? (
          <div className="flex items-center justify-center py-12 text-mc-text-secondary">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading agents…
          </div>
        ) : agents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-mc-border bg-mc-bg-secondary/40 p-10 text-center">
            <div className="text-4xl mb-2">🤖</div>
            <p className="text-sm text-mc-text">No agents configured yet.</p>
            <p className="text-xs text-mc-text-secondary mt-1">
              The Fury planner is auto-provisioned. Builder/Tester/Reviewer agents
              come from your workspace bootstrap.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map(a => (
              <li key={a.id}>
                <AgentCard
                  agent={a}
                  skillCount={skillCounts[a.id] ?? 0}
                  busy={busyId === a.id}
                  onSetAsLead={() => setAsLead(a.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  skillCount,
  busy,
  onSetAsLead,
}: {
  agent: AgentRow;
  skillCount: number;
  busy: boolean;
  onSetAsLead: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isLead = !!agent.is_lead;
  const dot = STATUS_DOT[agent.status] ?? 'bg-mc-text-secondary';

  return (
    <div
      className={`bg-mc-bg-secondary border rounded-xl p-4 transition-colors ${
        isLead ? 'border-mc-accent-yellow/60 shadow-[0_0_0_1px_rgba(212,153,34,0.2)]' : 'border-mc-border hover:border-mc-accent/40'
      }`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {isLead && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-mc-accent-yellow/20 text-mc-accent-yellow text-[10px] font-bold uppercase tracking-wider"
              title="Lead Agent — coordinates the team"
            >
              <Crown className="w-3 h-3" /> Lead
            </span>
          )}
          <span className={`w-2 h-2 rounded-full shrink-0 ${dot} ${agent.status === 'working' ? 'animate-pulse' : ''}`} />
          <span className="text-xs text-mc-text-secondary capitalize">{agent.status}</span>
        </div>
        <div className="relative">
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary"
            aria-label="More"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-40 w-44 rounded-lg border border-mc-border bg-mc-bg-secondary shadow-lg py-1">
                {!isLead && (
                  <button
                    onClick={() => { setMenuOpen(false); onSetAsLead(); }}
                    disabled={busy}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-mc-bg-tertiary flex items-center gap-2 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crown className="w-3.5 h-3.5 text-mc-accent-yellow" />}
                    Set as Lead
                  </button>
                )}
                <Link
                  href={`/agents/${agent.id}#settings`}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-mc-bg-tertiary flex items-center gap-2"
                >
                  <SettingsIcon className="w-3.5 h-3.5" /> Settings
                </Link>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Identity */}
      <div className="flex items-start gap-3 mb-3">
        <span className="text-3xl leading-none mt-0.5">{agent.avatar_emoji || '🤖'}</span>
        <div className="flex-1 min-w-0">
          <Link href={`/agents/${agent.id}`} className="block">
            <h3 className="text-sm font-semibold text-mc-text hover:text-mc-accent transition-colors truncate">
              {agent.name}
            </h3>
          </Link>
          <p className="text-xs text-mc-text-secondary capitalize truncate">{agent.role || 'general'}</p>
          {agent.description && (
            <p className="text-[11px] text-mc-text-secondary/80 mt-1 line-clamp-2">{agent.description}</p>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-[11px] text-mc-text-secondary mb-3">
        <span>
          <span className="text-mc-text font-mono tabular-nums">{skillCount}</span> skill{skillCount === 1 ? '' : 's'}
        </span>
        {agent.model && (
          <span className="truncate">
            <span className="text-mc-text-secondary/70">model:</span>{' '}
            <span className="font-mono text-mc-text-secondary">{agent.model.replace(/^claude-/, '')}</span>
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <Link
          href={`/agents/${agent.id}#chat`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 min-h-9 rounded-lg bg-mc-bg-tertiary text-mc-text border border-mc-border text-xs font-medium hover:border-mc-accent/40"
        >
          <MessageSquare className="w-3.5 h-3.5" /> Chat
        </Link>
        <Link
          href={`/agents/${agent.id}#skills`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90"
        >
          Configure
          <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
