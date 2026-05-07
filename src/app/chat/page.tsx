'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquare, Plus, Loader2, ChevronRight, Crown } from 'lucide-react';
import { ChatStream } from '@/components/chat-page/ChatStream';
import { ChatComposer, type ParsedCommand, type PendingAttachment } from '@/components/chat-page/ChatComposer';
import type { Agent } from '@/lib/types';

interface ModelsResponse {
  defaultModel: string;
  availableModels: string[];
  source?: string;
}

interface AgentRow extends Agent { is_lead?: boolean }

interface GatewaySession {
  key: string;
  sessionId?: string;
  status?: string;
  model?: string;
  updatedAt?: number | string;
  totalTokens?: number;
}

function shortModel(m: string | undefined): string {
  if (!m) return '';
  return m.replace(/^[^/]+\//, '').replace(/^claude-/, '');
}

function parseAgentFromKey(key: string): string {
  if (!key) return '';
  const parts = key.split(':');
  return parts[0] === 'agent' ? (parts[1] ?? '') : '';
}

function isUserChatSession(key: string): boolean {
  return /:user-chat:/.test(key);
}

export default function ChatPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string>('');
  const [sessions, setSessions] = useState<GatewaySession[]>([]);
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null);
  const [missionContext, setMissionContext] = useState<string | null>(null);
  const [bannerNote, setBannerNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');

  const activeAgent = useMemo(() => agents.find(a => a.id === activeAgentId) ?? null, [agents, activeAgentId]);

  // Phase 13M.4: persist last-active agent so /chat opens to your previous selection.
  useEffect(() => {
    if (activeAgentId) {
      try { window.localStorage.setItem('mc-chat-active-agent', activeAgentId); } catch { /* ignore */ }
    }
  }, [activeAgentId]);

  // Initial load: agents, models
  useEffect(() => {
    (async () => {
      try {
        const [aRes, mRes] = await Promise.all([
          fetch('/api/agents'),
          fetch('/api/openclaw/models'),
        ]);
        if (aRes.ok) {
          const list: AgentRow[] = await aRes.json();
          setAgents(list);
          // Phase 13M.4: prefer last-active from localStorage; else lead; else first.
          let preferred: AgentRow | undefined;
          try {
            const stored = window.localStorage.getItem('mc-chat-active-agent');
            if (stored) preferred = list.find(a => a.id === stored);
          } catch { /* ignore */ }
          if (!preferred) preferred = list.find(a => a.is_lead);
          setActiveAgentId((preferred ?? list[0])?.id ?? null);
        }
        if (mRes.ok) {
          const m: ModelsResponse = await mRes.json();
          setModels(m);
          setActiveModel(m.defaultModel);
        }
      } catch (err) {
        console.error('[ChatPage] init failed:', err);
      }
    })();
  }, []);

  // Load sessions list (filter to user-chat keys only)
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/openclaw/sessions');
      if (!res.ok) return;
      const data = await res.json();
      const wrapper = data?.sessions;
      const list: GatewaySession[] = Array.isArray(wrapper?.sessions) ? wrapper.sessions : Array.isArray(wrapper) ? wrapper : Array.isArray(data) ? data : [];
      const filtered = list.filter(s => isUserChatSession(s.key));
      filtered.sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
      setSessions(filtered);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => {
    const t = setInterval(loadSessions, 5_000);
    return () => clearInterval(t);
  }, [loadSessions]);

  // Auto-pick a session when activeAgent changes (most recent for that agent)
  useEffect(() => {
    if (!activeAgentId) return;
    const agent = agents.find(a => a.id === activeAgentId);
    if (!agent) return;
    // Match on session_key_prefix when present, else on key prefix
    const candidate = sessions.find(s => parseAgentFromKey(s.key) === (agent.session_key_prefix?.split(':')[1] ?? '') || s.key.includes(`user-chat:${activeAgentId}`));
    if (candidate) setActiveSessionKey(candidate.key);
    else setActiveSessionKey(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgentId, sessions.length]);

  const newSession = useCallback(async () => {
    if (!activeAgentId) return;
    setBusy(true);
    try {
      const res = await fetch('/api/chat/sessions/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: activeAgentId }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveSessionKey(data.sessionKey);
        setBannerNote('Started a fresh session.');
        await loadSessions();
      }
    } finally {
      setBusy(false);
    }
  }, [activeAgentId, loadSessions]);

  const handleCommand = useCallback(async (cmd: ParsedCommand, attachments: PendingAttachment[]) => {
    setBannerNote(null);

    if (cmd.kind === 'new') {
      await newSession();
      return;
    }
    if (cmd.kind === 'agent') {
      const name = (cmd.arg ?? '').toLowerCase();
      const next = agents.find(a => a.name.toLowerCase() === name);
      if (!next) throw new Error(`Agent "${cmd.arg}" not found`);
      setActiveAgentId(next.id);
      setBannerNote(`Switched to ${next.name}.`);
      return;
    }
    // /model removed in Phase 13M.3: this gateway version rejects model
    // overrides on chat.send. Model selection happens at session creation
    // via the agent's session_key_prefix instead.
    if (cmd.kind === 'task') {
      if (!activeAgentId) throw new Error('No active agent');
      const title = (cmd.arg ?? '').replace(/^"|"$/g, '').trim();
      if (!title) throw new Error('Use /task "your title here"');
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, status: 'inbox', priority: 'normal', assigned_agent_id: activeAgentId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Task creation failed (${res.status})`);
      }
      setBannerNote(`Task created and assigned to ${activeAgent?.name ?? 'agent'}.`);
      return;
    }
    if (cmd.kind === 'mission') {
      const id = (cmd.arg ?? '').trim();
      if (!id) throw new Error('Use /mission <mission-id>');
      const res = await fetch(`/api/missions/${id}`);
      if (!res.ok) throw new Error('Mission not found');
      const m = await res.json();
      const block = `[Mission context — ${m.parent_task?.title ?? m.name}]\n` +
        `Stage: ${m.mission_stage}\n` +
        (m.parent_task?.description ? `Description: ${m.parent_task.description}\n` : '') +
        (m.codebase_summary ? `\nCodebase summary:\n${m.codebase_summary}\n` : '');
      setMissionContext(block);
      setBannerNote(`Loaded mission "${m.parent_task?.title ?? m.name}" — it'll be prepended to your next send.`);
      return;
    }

    // kind === 'send'
    if (!activeAgentId) throw new Error('No active agent');
    const message = (missionContext ? missionContext + '\n---\n' : '') + (cmd.message ?? '');
    setMissionContext(null);

    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: activeAgentId,
        sessionKey: activeSessionKey ?? undefined,
        message,
        model: activeModel || undefined,
        attachments: attachments.map(a => ({ name: a.name, mimeType: a.mimeType, data: a.data })),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Send failed (${res.status})`);
    }
    const data = await res.json();
    if (data.sessionKey && !activeSessionKey) setActiveSessionKey(data.sessionKey);
    // Nudge poll cycle to grab the new state quickly
    setTimeout(() => loadSessions(), 500);
  }, [activeAgentId, activeAgent, activeSessionKey, activeModel, agents, missionContext, newSession, loadSessions]);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: sessions list */}
      <aside className="w-64 shrink-0 flex flex-col border-r border-mc-border bg-mc-bg-secondary/40">
        <div className="px-3 py-3 border-b border-mc-border flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-mc-text-secondary">
            Sessions {sessions.length > 0 && <span className="opacity-60">({sessions.length})</span>}
          </h2>
          <button
            onClick={newSession}
            disabled={busy || !activeAgentId}
            className="text-xs flex items-center gap-1 px-2 py-1 rounded bg-mc-accent text-mc-bg hover:bg-mc-accent/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            New
          </button>
        </div>

        {/* Phase 13M.4: search filter */}
        {sessions.length > 3 && (
          <div className="px-3 py-2 border-b border-mc-border">
            <input
              type="text"
              value={sessionSearch}
              onChange={e => setSessionSearch(e.target.value)}
              placeholder="Filter…"
              className="w-full text-xs bg-mc-bg border border-mc-border rounded px-2 py-1.5 focus:outline-none focus:border-mc-accent"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-2">
          {sessions.length === 0 ? (
            <p className="text-xs text-mc-text-secondary text-center py-6 px-4">
              No chat sessions yet. Pick an agent and click <strong className="text-mc-text">New</strong>.
            </p>
          ) : (() => {
            const q = sessionSearch.toLowerCase();
            const filtered = q
              ? sessions.filter(s => s.key.toLowerCase().includes(q) || (parseAgentFromKey(s.key) ?? '').toLowerCase().includes(q))
              : sessions;
            if (filtered.length === 0) {
              return <p className="text-xs text-mc-text-secondary text-center py-6 px-4">No sessions match &quot;{sessionSearch}&quot;.</p>;
            }
            return (
              <ul className="px-2 space-y-0.5">
                {filtered.map(s => {
                  const active = s.key === activeSessionKey;
                  const agentName = parseAgentFromKey(s.key);
                  const updated = s.updatedAt ? new Date(Number(s.updatedAt)) : null;
                  return (
                    <li key={s.key}>
                      <button
                        onClick={() => setActiveSessionKey(s.key)}
                        title={s.key}
                        className={`w-full text-left px-2 py-2 rounded text-xs ${active ? 'bg-mc-accent/15 text-mc-accent' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text'}`}
                      >
                        <div className="font-medium capitalize truncate">{agentName || s.key}</div>
                        <div className="flex items-center gap-2 text-[10px] mt-0.5 opacity-80">
                          {s.model && <span className="font-mono truncate">{shortModel(s.model)}</span>}
                          {updated && <span className="ml-auto whitespace-nowrap">{updated.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            );
          })()}
        </div>
      </aside>

      {/* Center: stream + composer */}
      <section className="flex-1 min-w-0 flex flex-col">
        <header className="px-4 py-3 border-b border-mc-border bg-mc-bg-secondary/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare className="w-4 h-4 text-mc-accent shrink-0" />
            <h2 className="text-sm font-semibold text-mc-text truncate">
              {activeAgent ? `Chat with ${activeAgent.name}` : 'Chat'}
            </h2>
            {activeAgent?.is_lead && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-mc-accent-yellow/20 text-mc-accent-yellow text-[10px] font-bold uppercase tracking-wider">
                <Crown className="w-3 h-3" /> Lead
              </span>
            )}
          </div>
          {activeSessionKey && (
            <span className="font-mono text-[10px] text-mc-text-secondary truncate max-w-[280px]" title={activeSessionKey}>
              {activeSessionKey}
            </span>
          )}
        </header>

        {bannerNote && (
          <div className="px-4 py-2 text-xs text-mc-accent-blue bg-mc-accent-blue/10 border-b border-mc-accent-blue/30">
            {bannerNote}
          </div>
        )}
        {missionContext && (
          <div className="px-4 py-2 text-xs text-mc-accent-purple bg-mc-accent-purple/10 border-b border-mc-accent-purple/30">
            Mission context queued — will be prepended to your next send.
          </div>
        )}

        <ChatStream sessionKey={activeSessionKey} agentName={activeAgent?.name} />

        <ChatComposer
          disabled={!activeAgentId}
          agentName={activeAgent?.name}
          onCommand={handleCommand}
        />
      </section>

      {/* Right: agent + model selector */}
      <aside className="w-64 shrink-0 flex flex-col border-l border-mc-border bg-mc-bg-secondary/40">
        <div className="px-3 py-3 border-b border-mc-border">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-mc-text-secondary">Agent</h2>
        </div>
        <div className="px-3 py-2 border-b border-mc-border space-y-1">
          {agents.length === 0 ? (
            <p className="text-xs text-mc-text-secondary py-3">No agents.</p>
          ) : agents.map(a => {
            const active = a.id === activeAgentId;
            return (
              <button
                key={a.id}
                onClick={() => setActiveAgentId(a.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs ${active ? 'bg-mc-accent/15 text-mc-accent' : 'hover:bg-mc-bg-tertiary text-mc-text-secondary'}`}
              >
                <span className="text-base shrink-0">{a.avatar_emoji || '🤖'}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium truncate">{a.name}</span>
                  <span className="block text-[10px] text-mc-text-secondary capitalize truncate">{a.role}</span>
                </span>
                {a.is_lead && <Crown className="w-3 h-3 text-mc-accent-yellow shrink-0" />}
                {active && <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>

        <div className="px-3 py-3 border-b border-mc-border">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-mc-text-secondary">Model</h2>
        </div>
        <div className="px-3 py-2 space-y-1 overflow-y-auto">
          {models === null ? (
            <p className="text-xs text-mc-text-secondary py-3">Loading…</p>
          ) : (
            models.availableModels.map(m => {
              const active = m === activeModel;
              return (
                <button
                  key={m}
                  onClick={() => setActiveModel(m)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs font-mono ${active ? 'bg-mc-accent/15 text-mc-accent' : 'hover:bg-mc-bg-tertiary text-mc-text-secondary'}`}
                >
                  {shortModel(m)}
                  {m === models.defaultModel && <span className="ml-1 text-[9px] text-mc-text-secondary uppercase">default</span>}
                </button>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
