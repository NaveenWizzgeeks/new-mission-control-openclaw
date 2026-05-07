'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock, Plus, Play, Edit3, Trash2, ToggleLeft, ToggleRight, Loader2, AlertCircle, X, Save, RefreshCw } from 'lucide-react';
import { formatDistanceToNow, formatDistanceToNowStrict } from 'date-fns';
import { useConfirm } from '@/components/ConfirmDialog';

const ACTION_TYPES = ['agent_health_check', 'memory_summarize', 'auto_propose', 'codebase_scan', 'custom'] as const;
type ActionType = typeof ACTION_TYPES[number];

const ACTION_LABEL: Record<ActionType, string> = {
  agent_health_check: 'Agent Health Check',
  memory_summarize: 'Memory Summarize',
  auto_propose: 'Auto Propose',
  codebase_scan: 'Codebase Scan',
  custom: 'Custom (HTTP)',
};

interface CronRow {
  id: string;
  name: string;
  schedule: string;
  schedule_human?: string;
  action_type: ActionType;
  config: Record<string, unknown>;
  last_run: string | null;
  last_run_status: string | null;
  next_run: string | null;
  enabled: boolean;
  created_at: string;
}

export default function CronsPage() {
  const confirmModal = useConfirm();
  const [rows, setRows] = useState<CronRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // id, 'new', or null
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/crons');
      if (res.ok) setRows(await res.json());
      else setRows([]);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/crons/${id}/toggle`, { method: 'PATCH' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Toggle failed (${res.status})`);
      } else {
        await load();
      }
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/crons/${id}/run-now`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Run failed (${res.status})`);
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!await confirmModal({
      title: `Delete cron "${name}"?`,
      body: 'Stops this scheduled job and removes its configuration.',
      confirmLabel: 'Delete cron',
      danger: true,
    })) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/crons/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Delete failed (${res.status})`);
      } else {
        await load();
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold mb-1 flex items-center gap-2">
              <Clock className="w-5 h-5 text-mc-accent" /> Cron Jobs
            </h2>
            <p className="text-sm text-mc-text-secondary">
              Scheduled background actions. The runner ticks every 30s; jobs whose <code>next_run</code> has elapsed
              fire automatically.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="text-xs px-3 py-1.5 rounded bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text border border-mc-border flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
            <button
              onClick={() => setEditing('new')}
              className="flex items-center gap-1.5 px-3 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90"
            >
              <Plus className="w-3.5 h-3.5" /> Add Cron
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-mc-text-secondary hover:text-mc-text"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {editing === 'new' && (
          <CronForm onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
        )}

        {rows === null ? (
          <p className="text-sm text-mc-text-secondary py-4">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-mc-border bg-mc-bg-secondary/40 p-10 text-center text-sm text-mc-text-secondary">
            No cron jobs yet. The seeded defaults (Agent Health Check, Memory Summarize) should appear after you reset
            the DB; otherwise click <strong>Add Cron</strong> to create one.
          </div>
        ) : (
          <div className="bg-mc-bg-secondary border border-mc-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-mc-bg/40 border-b border-mc-border">
                <tr>
                  <Th>Name</Th>
                  <Th>Schedule</Th>
                  <Th>Action</Th>
                  <Th>Next run</Th>
                  <Th>Last run</Th>
                  <Th>Status</Th>
                  <Th>Enabled</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => editing === r.id ? (
                  <tr key={r.id} className="border-b border-mc-border/60 bg-mc-bg/40">
                    <td colSpan={8} className="p-4">
                      <CronForm row={r} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="border-b border-mc-border/60 hover:bg-mc-bg-tertiary/30">
                    <td className="p-3 align-top">
                      <div className="text-sm text-mc-text font-medium">{r.name}</div>
                    </td>
                    <td className="p-3 align-top">
                      <div className="text-xs font-mono text-mc-text">{r.schedule}</div>
                      {r.schedule_human && r.schedule_human !== r.schedule && (
                        <div className="text-[10px] text-mc-text-secondary mt-0.5">{r.schedule_human}</div>
                      )}
                    </td>
                    <td className="p-3 align-top">
                      <span className="text-xs text-mc-text">{ACTION_LABEL[r.action_type]}</span>
                    </td>
                    <td className="p-3 align-top">
                      {r.next_run ? (
                        <span className="text-xs text-mc-text-secondary" title={r.next_run}>
                          in {formatDistanceToNowStrict(new Date(r.next_run))}
                        </span>
                      ) : (
                        <span className="text-xs text-mc-text-secondary/60">—</span>
                      )}
                    </td>
                    <td className="p-3 align-top">
                      {r.last_run ? (
                        <span className="text-xs text-mc-text-secondary" title={r.last_run}>
                          {formatDistanceToNow(new Date(r.last_run), { addSuffix: true })}
                        </span>
                      ) : (
                        <span className="text-xs text-mc-text-secondary/60">never</span>
                      )}
                    </td>
                    <td className="p-3 align-top">
                      <StatusPill text={r.last_run_status} />
                    </td>
                    <td className="p-3 align-top">
                      <button
                        onClick={() => toggle(r.id)}
                        disabled={busyId === r.id}
                        className="p-1 rounded hover:bg-mc-bg-tertiary disabled:opacity-40"
                        title={r.enabled ? 'Disable' : 'Enable'}
                      >
                        {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : (r.enabled ? <ToggleRight className="w-5 h-5 text-mc-accent-green" /> : <ToggleLeft className="w-5 h-5 text-mc-text-secondary" />)}
                      </button>
                    </td>
                    <td className="p-3 align-top text-right">
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => runNow(r.id)} disabled={busyId === r.id} title="Run now" className="p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-accent disabled:opacity-40">
                          {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        </button>
                        <button onClick={() => setEditing(r.id)} title="Edit" className="p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary">
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button onClick={() => remove(r.id, r.name)} disabled={busyId === r.id} title="Delete" className="p-1.5 rounded hover:bg-mc-accent-red/10 text-mc-accent-red disabled:opacity-40">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`text-left px-3 py-2 text-[10px] uppercase tracking-wider text-mc-text-secondary font-medium ${className}`}>{children}</th>;
}

function StatusPill({ text }: { text: string | null }) {
  if (!text) return <span className="text-xs text-mc-text-secondary/60">—</span>;
  const isErr = text.startsWith('error') || text.startsWith('disabled');
  const cls = isErr
    ? 'text-mc-accent-red bg-mc-accent-red/10 border-mc-accent-red/30'
    : 'text-mc-accent-green bg-mc-accent-green/10 border-mc-accent-green/30';
  const summary = text.replace(/^(success|error):\s*/, '').slice(0, 80);
  return <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] ${cls}`} title={text}>{summary || (isErr ? 'error' : 'ok')}</span>;
}

function CronForm({ row, onSaved, onCancel }: { row?: CronRow; onSaved: () => void; onCancel: () => void }) {
  const isEdit = !!row;
  const [name, setName] = useState(row?.name ?? '');
  const [schedule, setSchedule] = useState(row?.schedule ?? '@every 5m');
  const [actionType, setActionType] = useState<ActionType>(row?.action_type ?? 'agent_health_check');
  const [configText, setConfigText] = useState(JSON.stringify(row?.config ?? {}, null, 2));
  const [enabled, setEnabled] = useState(row?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) { setErr('Name is required'); return; }
    if (!schedule.trim()) { setErr('Schedule is required'); return; }
    let action_config: unknown = {};
    if (configText.trim()) {
      try { action_config = JSON.parse(configText); }
      catch { setErr('Action config must be valid JSON'); return; }
    }
    setSaving(true);
    setErr(null);
    try {
      const url = isEdit ? `/api/crons/${row!.id}` : '/api/crons';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), schedule: schedule.trim(), action_type: actionType, action_config, enabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.error || `Save failed (${res.status})`);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full min-h-9 bg-mc-bg border border-mc-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-mc-accent';

  return (
    <div className="bg-mc-bg-secondary border border-mc-accent/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">{isEdit ? `Edit "${row!.name}"` : 'New cron job'}</h4>
        <button onClick={onCancel} className="text-mc-text-secondary hover:text-mc-text"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Daily codebase scan" />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">
            Schedule
            <span className="ml-1 normal-case opacity-60">— `*/5 * * * *` or `@hourly` / `@daily` / `@every 5m`</span>
          </label>
          <input value={schedule} onChange={e => setSchedule(e.target.value)} className={`${inputCls} font-mono`} />
        </div>
      </div>

      <div>
        <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Action type</label>
        <select value={actionType} onChange={e => setActionType(e.target.value as ActionType)} className={inputCls}>
          {ACTION_TYPES.map(t => <option key={t} value={t}>{ACTION_LABEL[t]}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">
          Action config (JSON)
          {actionType === 'custom' && <span className="ml-1 normal-case opacity-60">— required: url; optional: method, headers, body</span>}
          {actionType === 'auto_propose' && <span className="ml-1 normal-case opacity-60">— optional: limit (max missions to propose for)</span>}
        </label>
        <textarea value={configText} onChange={e => setConfigText(e.target.value)} rows={5} className={`${inputCls} font-mono`} />
      </div>

      <label className="inline-flex items-center gap-2 text-xs text-mc-text-secondary cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        Enabled
      </label>

      {err && <div className="text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded px-2 py-1">{err}</div>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} className="min-h-9 px-3 rounded-lg text-xs text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary">Cancel</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90 disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save
        </button>
      </div>
    </div>
  );
}
