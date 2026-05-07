'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Webhook as WebhookIcon, Plus, RefreshCw, Loader2, Trash2, Zap, ToggleLeft, ToggleRight,
  CheckCircle2, AlertTriangle, X, Save, Copy, Check,
} from 'lucide-react';

interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  failure_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
}

interface Delivery {
  id: string;
  webhook_id: string;
  webhook_name: string | null;
  event_type: string;
  status_code: number | null;
  response_excerpt: string | null;
  error: string | null;
  attempt: number;
  duration_ms: number | null;
  delivered_at: string;
}

const COMMON_EVENTS = [
  '*',
  'task_updated',
  'note_queued',
  'note_delivered',
  'agent_health_changed',
  'mission_stage_changed',
  'convoy_progress',
  'webhook_test',
];

import { useConfirm } from '@/components/ConfirmDialog';

export function WebhooksDashboard() {
  const confirmModal = useConfirm();
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<{ name: string; secret: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [wRes, dRes] = await Promise.all([
        fetch('/api/webhooks'),
        fetch('/api/webhooks/deliveries?limit=50'),
      ]);
      if (wRes.ok) setWebhooks((await wRes.json()).items);
      if (dRes.ok) setDeliveries((await dRes.json()).items);
      if (!wRes.ok) setError(`Webhooks load failed (${wRes.status})`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (wh: Webhook) => {
    setBusyId(wh.id);
    try {
      await fetch(`/api/webhooks/${wh.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !wh.active }),
      });
      await load();
    } finally { setBusyId(null); }
  };

  const remove = async (wh: Webhook) => {
    if (!await confirmModal({
      title: `Delete webhook "${wh.name}"?`,
      body: 'Pending deliveries will be lost.',
      confirmLabel: 'Delete webhook',
      danger: true,
    })) return;
    setBusyId(wh.id);
    try {
      await fetch(`/api/webhooks/${wh.id}`, { method: 'DELETE' });
      await load();
    } finally { setBusyId(null); }
  };

  const ping = async (wh: Webhook) => {
    setBusyId(wh.id);
    try {
      await fetch(`/api/webhooks/${wh.id}/test`, { method: 'POST' });
      // Give the worker a moment to land deliveries.
      setTimeout(load, 1500);
    } finally { setBusyId(null); }
  };

  return (
    <>
      <div className="border-b border-mc-border bg-mc-bg-secondary px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-mc-accent-blue">
            <WebhookIcon className="w-5 h-5" />
            <h1 className="text-lg font-semibold text-mc-text">Webhooks</h1>
          </div>
          <span className="text-xs text-mc-text-secondary">
            Outbound delivery with retry · circuit breaker · HMAC-SHA256 signature.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 px-2.5 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90"
            >
              <Plus className="w-3.5 h-3.5" /> New webhook
            </button>
            <button
              onClick={load}
              className="flex items-center gap-1.5 px-2.5 min-h-9 rounded-lg border border-mc-border bg-mc-bg text-xs text-mc-text-secondary hover:text-mc-text"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-5">
        {error && (
          <div className="text-sm text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {createdSecret && (
          <div className="rounded-lg border border-mc-accent-green/40 bg-mc-accent-green/5 px-4 py-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-mc-accent-green shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-mc-text">Webhook &quot;{createdSecret.name}&quot; created.</p>
                <p className="text-xs text-mc-text-secondary mt-1">
                  Copy the signing secret now — it won&apos;t be shown again. Use it to verify the
                  <code className="text-mc-accent"> X-Mission-Control-Signature</code> header on receipt.
                </p>
                <SecretReveal secret={createdSecret.secret} />
              </div>
              <button onClick={() => setCreatedSecret(null)} className="p-1 text-mc-text-secondary hover:text-mc-text">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {creating && (
          <NewWebhookForm
            onCancel={() => setCreating(false)}
            onCreated={(wh, secret) => {
              setCreating(false);
              setCreatedSecret({ name: wh.name, secret });
              load();
            }}
          />
        )}

        <section>
          <h2 className="text-xs uppercase tracking-wider text-mc-text-secondary mb-2">Webhooks</h2>
          {!webhooks && !error && (
            <div className="flex items-center gap-2 text-sm text-mc-text-secondary py-12 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}
          {webhooks && webhooks.length === 0 && (
            <div className="text-center text-sm text-mc-text-secondary py-12 border border-dashed border-mc-border rounded-lg">
              No webhooks yet — click <strong>New webhook</strong> to add one.
            </div>
          )}
          {webhooks && webhooks.length > 0 && (
            <ul className="space-y-2">
              {webhooks.map(wh => (
                <li key={wh.id}>
                  <WebhookRow wh={wh} busy={busyId === wh.id} onToggle={() => toggle(wh)} onPing={() => ping(wh)} onRemove={() => remove(wh)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-wider text-mc-text-secondary mb-2">Recent deliveries</h2>
          {!deliveries && (
            <div className="text-sm text-mc-text-secondary py-4">Loading…</div>
          )}
          {deliveries && deliveries.length === 0 && (
            <div className="text-center text-sm text-mc-text-secondary py-6 border border-dashed border-mc-border rounded-lg">
              No deliveries yet.
            </div>
          )}
          {deliveries && deliveries.length > 0 && (
            <div className="rounded-lg border border-mc-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-mc-bg-secondary text-mc-text-secondary">
                  <tr>
                    <th className="text-left px-3 py-2">When</th>
                    <th className="text-left px-3 py-2">Webhook</th>
                    <th className="text-left px-3 py-2">Event</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Attempt</th>
                    <th className="text-left px-3 py-2">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map(d => (
                    <tr key={d.id} className="border-t border-mc-border">
                      <td className="px-3 py-1.5 text-mc-text-secondary whitespace-nowrap">{new Date(d.delivered_at).toLocaleTimeString()}</td>
                      <td className="px-3 py-1.5 text-mc-text truncate max-w-[160px]">{d.webhook_name ?? d.webhook_id.slice(0, 8)}</td>
                      <td className="px-3 py-1.5 font-mono text-mc-text-secondary">{d.event_type}</td>
                      <td className="px-3 py-1.5">
                        {d.status_code !== null && d.status_code >= 200 && d.status_code < 300 && (
                          <span className="inline-flex items-center gap-1 text-mc-accent-green">
                            <CheckCircle2 className="w-3 h-3" /> {d.status_code}
                          </span>
                        )}
                        {d.status_code !== null && (d.status_code < 200 || d.status_code >= 300) && (
                          <span className="inline-flex items-center gap-1 text-mc-accent-red">
                            <AlertTriangle className="w-3 h-3" /> {d.status_code}
                          </span>
                        )}
                        {d.status_code === null && (
                          <span className="inline-flex items-center gap-1 text-mc-accent-red" title={d.error ?? undefined}>
                            <AlertTriangle className="w-3 h-3" /> {d.error ?? 'error'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-mc-text-secondary">{d.attempt}</td>
                      <td className="px-3 py-1.5 text-mc-text-secondary">{d.duration_ms != null ? `${d.duration_ms}ms` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function WebhookRow({
  wh, busy, onToggle, onPing, onRemove,
}: { wh: Webhook; busy: boolean; onToggle: () => void; onPing: () => void; onRemove: () => void }) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${wh.active ? 'border-mc-border bg-mc-bg-secondary' : 'border-mc-accent-red/40 bg-mc-accent-red/5 opacity-80'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-mc-text truncate">{wh.name}</h3>
          {!wh.active && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-mc-accent-red/15 text-mc-accent-red border border-mc-accent-red/40">
              Disabled (CB tripped)
            </span>
          )}
        </div>
        <p className="text-xs text-mc-text-secondary font-mono truncate mt-0.5">{wh.url}</p>
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          {wh.events.map(e => (
            <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border text-mc-text-secondary font-mono">
              {e}
            </span>
          ))}
        </div>
        <p className="text-[10px] text-mc-text-secondary mt-1.5">
          {wh.failure_count > 0 && (
            <span className="text-mc-accent-red">⚠ {wh.failure_count} consecutive failures · </span>
          )}
          {wh.last_success_at && <>last ok {new Date(wh.last_success_at).toLocaleString()}</>}
          {!wh.last_success_at && wh.last_failure_at && <>last err {new Date(wh.last_failure_at).toLocaleString()}</>}
          {!wh.last_success_at && !wh.last_failure_at && <>never delivered</>}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={onPing} disabled={busy || !wh.active} className="p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-accent-blue disabled:opacity-30" title="Send test event">
          <Zap className="w-4 h-4" />
        </button>
        <button onClick={onToggle} disabled={busy} className="p-1.5 rounded hover:bg-mc-bg-tertiary" title={wh.active ? 'Disable' : 'Enable'}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : wh.active ? <ToggleRight className="w-4 h-4 text-mc-accent-green" /> : <ToggleLeft className="w-4 h-4 text-mc-text-secondary" />}
        </button>
        <button onClick={onRemove} disabled={busy} className="p-1.5 rounded hover:bg-mc-accent-red/10 text-mc-accent-red" title="Delete">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function NewWebhookForm({
  onCancel, onCreated,
}: { onCancel: () => void; onCreated: (wh: Webhook, secret: string) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['*']);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleEvent = (e: string) => {
    setEvents(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]);
  };

  const submit = async () => {
    if (!name.trim()) { setErr('Name required'); return; }
    if (!/^https?:\/\//.test(url)) { setErr('URL must start with http:// or https://'); return; }
    setSaving(true); setErr(null);
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: url.trim(), events: events.length > 0 ? events : ['*'] }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Create failed'); return; }
      onCreated(data, data.secret);
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border border-mc-accent/40 bg-mc-bg/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-mc-text">New webhook</h3>
        <button onClick={onCancel} className="text-mc-text-secondary hover:text-mc-text"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Slack notifier" className="w-full min-h-9 bg-mc-bg border border-mc-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-mc-accent" />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">URL</label>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://hooks.slack.com/services/…" className="w-full min-h-9 bg-mc-bg border border-mc-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-mc-accent" />
        </div>
      </div>
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Events to subscribe</label>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_EVENTS.map(e => (
            <button
              key={e}
              type="button"
              onClick={() => toggleEvent(e)}
              className={`text-[11px] px-2 py-0.5 rounded font-mono border transition-colors ${
                events.includes(e)
                  ? 'bg-mc-accent text-mc-bg border-mc-accent'
                  : 'bg-mc-bg text-mc-text-secondary border-mc-border hover:text-mc-text'
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      {err && <p className="text-xs text-mc-accent-red">{err}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="min-h-9 px-3 rounded-lg text-xs text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary">Cancel</button>
        <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 px-4 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90 disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Create
        </button>
      </div>
    </div>
  );
}

function SecretReveal({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 mt-2">
      <code className="flex-1 text-[11px] font-mono px-2 py-1 rounded bg-mc-bg-tertiary border border-mc-border break-all">{secret}</code>
      <button
        onClick={() => { navigator.clipboard.writeText(secret); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="p-1.5 rounded border border-mc-border bg-mc-bg hover:bg-mc-bg-tertiary"
        title="Copy"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-mc-accent-green" /> : <Copy className="w-3.5 h-3.5 text-mc-text-secondary" />}
      </button>
    </div>
  );
}
