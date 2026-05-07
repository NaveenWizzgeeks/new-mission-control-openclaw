'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Github, Plus, RefreshCw, Loader2, Trash2, ExternalLink, X, Save, CheckCircle2,
  AlertCircle, ArrowRightLeft, Download,
} from 'lucide-react';

interface SyncConfig {
  id: string;
  workspace_id: string | null;
  mission_id: string | null;
  repo_owner: string;
  repo_name: string;
  token: string; // already masked
  default_label: string | null;
  sync_enabled: number;
  last_sync_at: string | null;
  created_at: string;
}

interface SyncLink {
  id: string;
  mission_id: string;
  mission_name: string | null;
  repo_owner: string;
  repo_name: string;
  issue_number: number;
  issue_state: string | null;
  last_synced_at: string | null;
  created_at: string;
}

interface Workspace {
  id: string;
  name: string;
}

import { useConfirm } from '@/components/ConfirmDialog';

export function GitHubSyncDashboard() {
  const confirmModal = useConfirm();
  const [configs, setConfigs] = useState<SyncConfig[] | null>(null);
  const [links, setLinks] = useState<SyncLink[] | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [pollResult, setPollResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [c, l, w] = await Promise.all([
        fetch('/api/integrations/github/configs'),
        fetch('/api/integrations/github/links'),
        fetch('/api/workspaces'),
      ]);
      if (c.ok) setConfigs((await c.json()).items);
      if (l.ok) setLinks((await l.json()).items);
      if (w.ok) {
        const wd = await w.json();
        setWorkspaces(Array.isArray(wd) ? wd : (wd.items ?? wd.workspaces ?? []));
      }
      if (!c.ok) setError(`Configs load failed (${c.status})`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (cfg: SyncConfig) => {
    if (!await confirmModal({
      title: `Disconnect ${cfg.repo_owner}/${cfg.repo_name}?`,
      body: 'Mission-issue links stay in the DB; future stage transitions stop syncing to this repo.',
      confirmLabel: 'Disconnect repo',
      danger: true,
    })) return;
    setBusyId(cfg.id);
    try {
      await fetch(`/api/integrations/github/configs/${cfg.id}`, { method: 'DELETE' });
      await load();
    } finally { setBusyId(null); }
  };

  const pollNow = async () => {
    setPolling(true); setPollResult(null);
    try {
      const r = await fetch('/api/integrations/github/poll', { method: 'POST' });
      const d = await r.json();
      setPollResult(`Poll: scanned ${d.scanned}, changed ${d.changed}, errors ${d.errors}`);
      await load();
    } catch (err) {
      setPollResult(err instanceof Error ? err.message : 'Poll failed');
    } finally {
      setPolling(false);
    }
  };

  return (
    <>
      <div className="border-b border-mc-border bg-mc-bg-secondary px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-mc-text">
            <Github className="w-5 h-5" />
            <h1 className="text-lg font-semibold">GitHub Issues Sync</h1>
          </div>
          <span className="text-xs text-mc-text-secondary">
            Bidirectional · Missions ↔ Issues · Stage ↔ Labels · External close → mission done.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={pollNow}
              disabled={polling || (links?.length ?? 0) === 0}
              className="flex items-center gap-1.5 px-2.5 min-h-9 rounded-lg border border-mc-border bg-mc-bg text-xs text-mc-text-secondary hover:text-mc-text disabled:opacity-50"
              title="Pull updates from GitHub"
            >
              {polling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Poll now
            </button>
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 px-2.5 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90"
            >
              <Plus className="w-3.5 h-3.5" /> Connect repo
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
        {pollResult && (
          <p className="text-[11px] text-mc-text-secondary mt-2">{pollResult}</p>
        )}
        <p className="text-[11px] text-mc-text-secondary mt-2">
          Need recurring polls? Add a cron with action=<code>custom</code> · URL <code>/api/integrations/github/poll</code>
          · method <code>POST</code>.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-5">
        {error && (
          <div className="text-sm text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">{error}</div>
        )}

        {creating && (
          <NewConfigForm
            workspaces={workspaces}
            onCancel={() => setCreating(false)}
            onCreated={() => { setCreating(false); load(); }}
          />
        )}

        <section>
          <h2 className="text-xs uppercase tracking-wider text-mc-text-secondary mb-2">
            Connected repos {configs ? `(${configs.length})` : ''}
          </h2>
          {!configs && (
            <div className="text-sm text-mc-text-secondary py-6">Loading…</div>
          )}
          {configs && configs.length === 0 && (
            <div className="text-center text-sm text-mc-text-secondary py-12 border border-dashed border-mc-border rounded-lg">
              No repos connected — click <strong>Connect repo</strong>.
            </div>
          )}
          {configs && configs.length > 0 && (
            <ul className="space-y-2">
              {configs.map(c => (
                <li key={c.id}>
                  <ConfigRow cfg={c} workspaces={workspaces} busy={busyId === c.id} onRemove={() => remove(c)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-wider text-mc-text-secondary mb-2">
            Mission ↔ Issue links {links ? `(${links.length})` : ''}
          </h2>
          {!links && <div className="text-sm text-mc-text-secondary py-4">Loading…</div>}
          {links && links.length === 0 && (
            <div className="text-center text-sm text-mc-text-secondary py-6 border border-dashed border-mc-border rounded-lg">
              No links yet. They appear automatically the first time a mission&apos;s stage changes after you connect a repo.
            </div>
          )}
          {links && links.length > 0 && (
            <div className="rounded-lg border border-mc-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-mc-bg-secondary text-mc-text-secondary">
                  <tr>
                    <th className="text-left px-3 py-2">Mission</th>
                    <th className="text-left px-3 py-2">Repo</th>
                    <th className="text-left px-3 py-2">Issue</th>
                    <th className="text-left px-3 py-2">State</th>
                    <th className="text-left px-3 py-2">Last sync</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map(l => (
                    <tr key={l.id} className="border-t border-mc-border">
                      <td className="px-3 py-1.5 text-mc-text truncate max-w-[300px]">{l.mission_name ?? l.mission_id.slice(0, 8)}</td>
                      <td className="px-3 py-1.5 text-mc-text-secondary font-mono">{l.repo_owner}/{l.repo_name}</td>
                      <td className="px-3 py-1.5">
                        <a href={`https://github.com/${l.repo_owner}/${l.repo_name}/issues/${l.issue_number}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-mc-accent hover:underline">
                          #{l.issue_number} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </td>
                      <td className="px-3 py-1.5">
                        {l.issue_state === 'closed'
                          ? <span className="inline-flex items-center gap-1 text-mc-accent-red"><CheckCircle2 className="w-3 h-3" /> closed</span>
                          : <span className="inline-flex items-center gap-1 text-mc-accent-green"><ArrowRightLeft className="w-3 h-3" /> {l.issue_state ?? 'open'}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-mc-text-secondary">{l.last_synced_at ? new Date(l.last_synced_at).toLocaleString() : '—'}</td>
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

function ConfigRow({ cfg, workspaces, busy, onRemove }: { cfg: SyncConfig; workspaces: Workspace[]; busy: boolean; onRemove: () => void }) {
  const ws = workspaces.find(w => w.id === cfg.workspace_id);
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-mc-border bg-mc-bg-secondary">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-mc-text font-mono truncate">{cfg.repo_owner}/{cfg.repo_name}</h3>
          {cfg.workspace_id && ws && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border text-mc-text-secondary">
              workspace: {ws.name}
            </span>
          )}
          {cfg.mission_id && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border text-mc-text-secondary">
              mission-only
            </span>
          )}
          {cfg.default_label && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-mc-accent-purple/10 text-mc-accent-purple border border-mc-accent-purple/40">
              label: {cfg.default_label}
            </span>
          )}
        </div>
        <p className="text-[11px] text-mc-text-secondary mt-1 font-mono">PAT: {cfg.token}</p>
        <p className="text-[11px] text-mc-text-secondary mt-0.5">
          {cfg.last_sync_at ? `Last sync: ${new Date(cfg.last_sync_at).toLocaleString()}` : 'Never synced — waiting for first stage change'}
        </p>
      </div>
      <button onClick={onRemove} disabled={busy} className="p-1.5 rounded hover:bg-mc-accent-red/10 text-mc-accent-red" title="Delete">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function NewConfigForm({ workspaces, onCancel, onCreated }: { workspaces: Workspace[]; onCancel: () => void; onCreated: () => void }) {
  const [scope, setScope] = useState<'workspace' | 'mission'>('workspace');
  const [workspaceId, setWorkspaceId] = useState<string>(workspaces[0]?.id ?? '');
  const [missionId, setMissionId] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('mission-control');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    const m = repoUrl.match(/(?:github\.com\/)?([^/\s]+)\/([^/\s.]+)/);
    if (!m) { setErr('Use the format owner/repo or full GitHub URL'); return; }
    if (!token || token.length < 16) { setErr('Paste a real GitHub PAT'); return; }
    if (scope === 'workspace' && !workspaceId) { setErr('Pick a workspace'); return; }
    if (scope === 'mission' && !missionId.trim()) { setErr('Paste a mission id'); return; }
    setSaving(true);
    try {
      const body = {
        repo_owner: m[1],
        repo_name: m[2].replace(/\.git$/, ''),
        token,
        default_label: label.trim() || undefined,
        workspace_id: scope === 'workspace' ? workspaceId : undefined,
        mission_id: scope === 'mission' ? missionId.trim() : undefined,
      };
      const res = await fetch('/api/integrations/github/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Create failed'); return; }
      onCreated();
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border border-mc-accent/40 bg-mc-bg/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-mc-text">Connect a repo</h3>
        <button onClick={onCancel} className="text-mc-text-secondary hover:text-mc-text"><X className="w-4 h-4" /></button>
      </div>

      <div className="inline-flex rounded-lg border border-mc-border bg-mc-bg overflow-hidden text-xs">
        <button onClick={() => setScope('workspace')} className={`px-3 min-h-9 ${scope === 'workspace' ? 'bg-mc-accent text-mc-bg' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'}`}>
          Workspace default
        </button>
        <button onClick={() => setScope('mission')} className={`px-3 min-h-9 ${scope === 'mission' ? 'bg-mc-accent text-mc-bg' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'}`}>
          Single mission
        </button>
      </div>

      {scope === 'workspace' && (
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Workspace</label>
          <select value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} className="w-full min-h-9 bg-mc-bg border border-mc-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-mc-accent">
            {workspaces.length === 0 && <option>No workspaces</option>}
            {workspaces.map(w => (<option key={w.id} value={w.id}>{w.name}</option>))}
          </select>
        </div>
      )}
      {scope === 'mission' && (
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Mission ID</label>
          <input value={missionId} onChange={e => setMissionId(e.target.value)} placeholder="convoy id (UUID)" className="w-full min-h-9 bg-mc-bg border border-mc-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-mc-accent" />
        </div>
      )}

      <div>
        <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Repo</label>
        <input value={repoUrl} onChange={e => setRepoUrl(e.target.value)} placeholder="owner/repo or https://github.com/owner/repo" className="w-full min-h-9 bg-mc-bg border border-mc-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-mc-accent" />
      </div>
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">
          Personal access token <span className="text-mc-accent-yellow normal-case">(needs <code>repo</code> scope)</span>
        </label>
        <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="github_pat_… or ghp_…" className="w-full min-h-9 bg-mc-bg border border-mc-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-mc-accent" />
        <p className="text-[10px] text-mc-text-secondary mt-1 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          Stored in plaintext for now. Phase 14 vault will encrypt it.
        </p>
      </div>
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Default label (optional)</label>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="mission-control" className="w-full min-h-9 bg-mc-bg border border-mc-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-mc-accent" />
      </div>

      {err && <p className="text-xs text-mc-accent-red">{err}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="min-h-9 px-3 rounded-lg text-xs text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary">Cancel</button>
        <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 px-4 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90 disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Connect & validate
        </button>
      </div>
    </div>
  );
}
