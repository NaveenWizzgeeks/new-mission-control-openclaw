'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, MessageSquare, Wrench, Brain, History, Settings as SettingsIcon, Crown, Loader2 } from 'lucide-react';
import { AgentSkillsTab } from '@/components/agents/AgentSkillsTab';
import { AgentSettingsTab } from '@/components/agents/AgentSettingsTab';
import type { Agent } from '@/lib/types';

type TabKey = 'skills' | 'settings' | 'chat' | 'memory' | 'sessions';

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: 'skills', label: 'Skills', icon: <Wrench className="w-3.5 h-3.5" /> },
  { key: 'settings', label: 'Settings', icon: <SettingsIcon className="w-3.5 h-3.5" /> },
  { key: 'chat', label: 'Chat', icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { key: 'memory', label: 'Memory', icon: <Brain className="w-3.5 h-3.5" /> },
  { key: 'sessions', label: 'Sessions', icon: <History className="w-3.5 h-3.5" /> },
];

interface AgentRow extends Agent {
  is_lead?: boolean;
  is_global?: boolean;
}

export default function AgentDetailPage() {
  const params = useParams();
  const agentId = params.id as string;
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<TabKey>('skills');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}`);
      if (res.status === 404) { setNotFound(true); return; }
      if (res.ok) setAgent(await res.json());
    } catch {
      setNotFound(true);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  // Tab from hash
  useEffect(() => {
    const fromHash = (): TabKey => {
      const h = window.location.hash.replace('#', '');
      return (['skills', 'settings', 'chat', 'memory', 'sessions'] as const).includes(h as TabKey) ? (h as TabKey) : 'skills';
    };
    setTab(fromHash());
    const onHash = () => setTab(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const setTabAndHash = (next: TabKey) => {
    setTab(next);
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${next}`);
  };

  if (notFound) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold mb-2">Agent Not Found</h1>
          <Link href="/agents" className="inline-flex items-center gap-2 px-6 py-3 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90">
            <ChevronLeft className="w-4 h-4" /> Back to Agents
          </Link>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex-1 flex items-center justify-center text-mc-text-secondary">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading agent…
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="border-b border-mc-border bg-mc-bg-secondary/30 px-6 py-4 flex-shrink-0">
        <Link href="/agents" className="inline-flex items-center gap-1 text-xs text-mc-text-secondary hover:text-mc-text mb-2">
          <ChevronLeft className="w-3.5 h-3.5" /> Agents
        </Link>
        <div className="flex items-start gap-4">
          <span className="text-4xl leading-none">{agent.avatar_emoji || '🤖'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h1 className="text-xl font-bold text-mc-text">{agent.name}</h1>
              {agent.is_lead && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-mc-accent-yellow/20 text-mc-accent-yellow text-[10px] font-bold uppercase tracking-wider">
                  <Crown className="w-3 h-3" /> Lead
                </span>
              )}
              <span className={`w-2 h-2 rounded-full ${agent.status === 'working' ? 'bg-mc-accent-green animate-pulse' : agent.status === 'standby' ? 'bg-mc-accent-yellow' : 'bg-mc-text-secondary'}`} />
              <span className="text-xs text-mc-text-secondary capitalize">{agent.status}</span>
            </div>
            <p className="text-sm text-mc-text-secondary capitalize">{agent.role}</p>
            {agent.description && <p className="text-xs text-mc-text-secondary/80 mt-1 max-w-2xl">{agent.description}</p>}
          </div>
        </div>

        {/* Tabs */}
        <nav className="flex items-center gap-0.5 mt-4 -mb-4">
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTabAndHash(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  active ? 'border-mc-accent text-mc-accent' : 'border-transparent text-mc-text-secondary hover:text-mc-text'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {tab === 'skills' && <AgentSkillsTab agentId={agent.id} />}
          {tab === 'settings' && <AgentSettingsTab agent={agent} onAgentUpdated={load} />}
          {tab === 'chat' && <Stub icon="💬" title="Direct chat" body="Phase 11 (full OpenClaw chat UI) wires this. Agent-direct chat will let you send free-form messages and create tasks via /task slash commands." />}
          {tab === 'memory' && <Stub icon="🧠" title="Memory summaries" body="Phase 8 (Memory system) builds summarization on session completion and shows recent summaries here." />}
          {tab === 'sessions' && <Stub icon="🕒" title="Session history" body="Phase 9 (Sessions dashboard) adds the per-agent filter view with token usage, cost, and expandable transcripts." />}
        </div>
      </div>
    </>
  );
}

function Stub({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-8 text-center text-mc-text-secondary">
      <div className="text-4xl mb-3">{icon}</div>
      <h3 className="text-base font-semibold text-mc-text mb-1">{title}</h3>
      <p className="text-sm max-w-md mx-auto">{body}</p>
    </div>
  );
}
