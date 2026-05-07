'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save, Trash2, Crown } from 'lucide-react';
import type { Agent } from '@/lib/types';
import { useConfirm } from '@/components/ConfirmDialog';

interface AgentSettingsTabProps {
  agent: Agent & { is_lead?: boolean; is_global?: boolean };
  onAgentUpdated?: () => void;
}

export function AgentSettingsTab({ agent, onAgentUpdated }: AgentSettingsTabProps) {
  const router = useRouter();
  const confirmModal = useConfirm();
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role);
  const [description, setDescription] = useState(agent.description || '');
  const [model, setModel] = useState(agent.model || '');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(agent.name);
    setRole(agent.role);
    setDescription(agent.description || '');
    setModel(agent.model || '');
  }, [agent]);

  const dirty = name !== agent.name || role !== agent.role
    || description !== (agent.description || '') || model !== (agent.model || '');

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          role: role.trim(),
          description: description.trim() || null,
          model: model.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Save failed (${res.status})`);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        onAgentUpdated?.();
      }
    } finally {
      setSaving(false);
    }
  };

  const setLead = async () => {
    if (agent.is_lead) return;
    setBusy('lead');
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agent.id}/set-lead`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed (${res.status})`);
      } else {
        onAgentUpdated?.();
      }
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!await confirmModal({
      title: `Delete agent "${agent.name}"?`,
      body: 'The agent and all its skills, memory summaries, and history will be removed. This cannot be undone.',
      confirmLabel: 'Delete agent',
      danger: true,
    })) return;
    setBusy('delete');
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Delete failed (${res.status})`);
      } else {
        router.push('/agents');
      }
    } finally {
      setBusy(null);
    }
  };

  const inputCls = 'w-full min-h-10 bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-mc-accent';
  const taCls = 'w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none';

  return (
    <div className="space-y-5">
      {/* Identity */}
      <section className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-mc-text-secondary">Identity</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Role</label>
            <input type="text" value={role} onChange={e => setRole(e.target.value)} className={`${inputCls} font-mono`} placeholder="planner | builder | tester | reviewer | general" />
          </div>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={taCls} placeholder="What this agent does best." />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Model (optional)</label>
          <input type="text" value={model} onChange={e => setModel(e.target.value)} className={`${inputCls} font-mono`} placeholder="claude-cli/claude-sonnet-4-6" />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="flex items-center gap-1.5 px-4 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saved ? 'Saved' : 'Save changes'}
          </button>
          {saved && <span className="text-xs text-mc-accent-green">✓ Updated</span>}
        </div>
      </section>

      {/* Lead */}
      <section className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Crown className={`w-5 h-5 mt-0.5 shrink-0 ${agent.is_lead ? 'text-mc-accent-yellow' : 'text-mc-text-secondary'}`} />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-mc-text">Lead Agent</h3>
            <p className="text-xs text-mc-text-secondary mt-0.5">
              {agent.is_lead
                ? 'This agent is the current Lead. They coordinate the team and have visibility across missions.'
                : 'Promote this agent to Lead. The previous Lead is automatically demoted.'}
            </p>
            {!agent.is_lead && (
              <button
                onClick={setLead}
                disabled={busy === 'lead'}
                className="mt-3 flex items-center gap-1.5 px-4 min-h-9 rounded-lg bg-mc-accent-yellow/15 text-mc-accent-yellow border border-mc-accent-yellow/40 text-xs font-medium hover:bg-mc-accent-yellow/25 disabled:opacity-50"
              >
                {busy === 'lead' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crown className="w-3.5 h-3.5" />}
                Set as Lead
              </button>
            )}
          </div>
        </div>
      </section>

      {error && (
        <div className="text-sm text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Danger zone */}
      <section className="bg-mc-bg-secondary border border-mc-accent-red/40 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-mc-accent-red uppercase tracking-wider">Danger zone</h3>
        <p className="text-xs text-mc-text-secondary mt-1 mb-3">
          Deleting removes the agent and all their skills. Active sessions become orphaned.
        </p>
        <button
          onClick={remove}
          disabled={busy === 'delete'}
          className="flex items-center gap-1.5 px-4 min-h-9 rounded-lg bg-mc-accent-red/15 text-mc-accent-red border border-mc-accent-red/40 text-xs font-medium hover:bg-mc-accent-red/25 disabled:opacity-50"
        >
          {busy === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          Delete agent
        </button>
      </section>
    </div>
  );
}
