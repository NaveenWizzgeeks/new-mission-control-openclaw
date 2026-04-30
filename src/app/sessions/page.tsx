'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, Loader2, Download, ChevronUp, ChevronDown, Search, Filter } from 'lucide-react';
import { LineChart, DonutChart } from '@/components/sessions/charts';
import { estimateCost, formatUSD } from '@/lib/sessions/pricing';
import { SessionTranscript } from '@/components/sessions/SessionTranscript';

interface GatewaySession {
  id?: string;
  sessionId?: string;
  key: string;
  channel?: string;
  peer?: string;
  model?: string;
  status?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  startedAt?: number | string;
  endedAt?: number | string | null;
  updatedAt?: number | string;
  runtimeMs?: number;
}

type SortKey = 'updatedAt' | 'totalTokens' | 'inputTokens' | 'outputTokens' | 'cost' | 'model' | 'agent';

const PAGE_SIZE = 25;

const MODEL_PALETTE = ['#58a6ff', '#7ee787', '#d2a8ff', '#ffa657', '#f778ba', '#a5d6ff', '#56d4dd', '#f1e05a'];

function parseAgentFromKey(key: string): string {
  // agent:fury:planning:abc → fury
  if (!key) return 'unknown';
  const parts = key.split(':');
  if (parts[0] !== 'agent') return key;
  return parts[1] ?? 'unknown';
}

function sessionKindFromKey(key: string): string {
  // agent:fury:planning:abc → planning
  if (!key) return '';
  const parts = key.split(':');
  return parts[2] || '';
}

function shortModel(model: string | undefined): string {
  if (!model) return '—';
  return model.replace(/^[^/]+\//, '').replace(/^claude-/, '');
}

function ts(value: number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const n = Number(value);
  if (!isNaN(n) && n > 1e10) return n; // already a ms timestamp
  const d = new Date(value);
  return d.getTime() || 0;
}

function dateBucket(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD
}

function exportToCsv(rows: GatewaySession[], filename: string): void {
  const cols = ['key', 'sessionId', 'agent', 'kind', 'model', 'status', 'inputTokens', 'outputTokens', 'totalTokens', 'startedAt', 'endedAt', 'runtimeMs', 'estCostUSD'];
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) {
    const cost = estimateCost({
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadInputTokens,
      cacheWriteTokens: r.cacheCreationInputTokens,
    });
    lines.push([
      r.key, r.sessionId, parseAgentFromKey(r.key), sessionKindFromKey(r.key),
      r.model, r.status, r.inputTokens, r.outputTokens, r.totalTokens,
      r.startedAt, r.endedAt, r.runtimeMs, cost === null ? '' : cost.toFixed(6),
    ].map(escape).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function SessionsDashboardPage() {
  const [sessions, setSessions] = useState<GatewaySession[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);

  // Filters
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Sort + paging
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);

  // Expanded transcripts
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/openclaw/sessions');
      if (res.status === 503) {
        setUnavailable(true);
        return;
      }
      if (!res.ok) {
        setSessions([]);
        return;
      }
      const data = await res.json();
      const wrapper = data?.sessions;
      const list: GatewaySession[] = Array.isArray(wrapper?.sessions)
        ? wrapper.sessions
        : Array.isArray(wrapper)
        ? wrapper
        : Array.isArray(data) ? data : [];
      setSessions(list);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Distinct filter dropdown options
  const agentOptions = useMemo(() => {
    const set = new Set<string>();
    (sessions ?? []).forEach(s => set.add(parseAgentFromKey(s.key)));
    return Array.from(set).sort();
  }, [sessions]);
  const modelOptions = useMemo(() => {
    const set = new Set<string>();
    (sessions ?? []).forEach(s => { if (s.model) set.add(shortModel(s.model)); });
    return Array.from(set).sort();
  }, [sessions]);
  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    (sessions ?? []).forEach(s => { if (s.status) set.add(s.status); });
    return Array.from(set).sort();
  }, [sessions]);

  // Filtered list
  const filtered = useMemo(() => {
    const all = sessions ?? [];
    const q = search.trim().toLowerCase();
    return all.filter(s => {
      if (agentFilter !== 'all' && parseAgentFromKey(s.key) !== agentFilter) return false;
      if (modelFilter !== 'all' && shortModel(s.model) !== modelFilter) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (q) {
        const hay = `${s.key} ${s.peer ?? ''} ${s.channel ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sessions, agentFilter, modelFilter, statusFilter, search]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av: number | string = 0; let bv: number | string = 0;
      if (sortKey === 'updatedAt') { av = ts(a.updatedAt ?? a.startedAt); bv = ts(b.updatedAt ?? b.startedAt); }
      else if (sortKey === 'totalTokens') { av = a.totalTokens ?? 0; bv = b.totalTokens ?? 0; }
      else if (sortKey === 'inputTokens') { av = a.inputTokens ?? 0; bv = b.inputTokens ?? 0; }
      else if (sortKey === 'outputTokens') { av = a.outputTokens ?? 0; bv = b.outputTokens ?? 0; }
      else if (sortKey === 'cost') {
        av = estimateCost({ model: a.model, inputTokens: a.inputTokens, outputTokens: a.outputTokens }) ?? -1;
        bv = estimateCost({ model: b.model, inputTokens: b.inputTokens, outputTokens: b.outputTokens }) ?? -1;
      }
      else if (sortKey === 'model') { av = shortModel(a.model); bv = shortModel(b.model); }
      else if (sortKey === 'agent') { av = parseAgentFromKey(a.key); bv = parseAgentFromKey(b.key); }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const pageRows = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  // Aggregates
  const stats = useMemo(() => {
    const all = sessions ?? [];
    const sum = (acc: number, n: number | undefined) => acc + (n ?? 0);
    const inputs = all.reduce((a, s) => sum(a, s.inputTokens), 0);
    const outputs = all.reduce((a, s) => sum(a, s.outputTokens), 0);
    const cache = all.reduce((a, s) => sum(a, (s.cacheReadInputTokens ?? 0) + (s.cacheCreationInputTokens ?? 0)), 0);
    let cost = 0;
    let costAvailable = false;
    for (const s of all) {
      const c = estimateCost({
        model: s.model, inputTokens: s.inputTokens, outputTokens: s.outputTokens,
        cacheReadTokens: s.cacheReadInputTokens, cacheWriteTokens: s.cacheCreationInputTokens,
      });
      if (c !== null) { cost += c; costAvailable = true; }
    }
    return { total: all.length, inputs, outputs, cache, cost, costAvailable };
  }, [sessions]);

  // Daily tokens series (last 30 days based on updatedAt)
  const dailySeries = useMemo(() => {
    const now = Date.now();
    const dayMs = 86_400_000;
    const days: Array<{ label: string; values: number[] }> = [];
    const map = new Map<string, { in: number; out: number }>();
    for (const s of sessions ?? []) {
      const t = ts(s.updatedAt ?? s.startedAt);
      if (!t || now - t > 30 * dayMs) continue;
      const bucket = dateBucket(t);
      const prev = map.get(bucket) ?? { in: 0, out: 0 };
      prev.in += s.inputTokens ?? 0;
      prev.out += s.outputTokens ?? 0;
      map.set(bucket, prev);
    }
    // Fill the last 14 days even if zero
    const span = 14;
    for (let i = span - 1; i >= 0; i--) {
      const d = new Date(now - i * dayMs);
      const bucket = d.toISOString().slice(0, 10);
      const m = map.get(bucket) ?? { in: 0, out: 0 };
      days.push({ label: bucket.slice(5), values: [m.in, m.out] });
    }
    return days;
  }, [sessions]);

  // Tokens by model donut
  const byModel = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions ?? []) {
      const m = shortModel(s.model);
      const t = s.totalTokens ?? 0;
      map.set(m, (map.get(m) ?? 0) + t);
    }
    return Array.from(map.entries())
      .map(([label, value], i) => ({ label, value, color: MODEL_PALETTE[i % MODEL_PALETTE.length] }))
      .sort((a, b) => b.value - a.value);
  }, [sessions]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
    setPage(0);
  };

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-mc-text-secondary hover:text-mc-text">
      {label}
      {sortKey === k && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
    </button>
  );

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold mb-1 flex items-center gap-2">
              <Activity className="w-5 h-5 text-mc-accent" /> Sessions
            </h2>
            <p className="text-sm text-mc-text-secondary">
              All OpenClaw sessions across the gateway. Token usage and estimated cost per Anthropic published pricing.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text border border-mc-border flex items-center gap-1 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Refresh
            </button>
            <button
              onClick={() => exportToCsv(sorted, `sessions-${new Date().toISOString().slice(0, 10)}.csv`)}
              disabled={(sessions ?? []).length === 0}
              className="text-xs px-3 py-1.5 rounded bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text border border-mc-border flex items-center gap-1 disabled:opacity-50"
            >
              <Download className="w-3 h-3" /> CSV
            </button>
          </div>
        </div>

        {unavailable && (
          <div className="text-sm text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
            Gateway unreachable. Cannot list sessions.
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Total Sessions" value={stats.total.toString()} accent="text-mc-text" />
          <Stat label="Input Tokens" value={fmtNum(stats.inputs)} accent="text-mc-accent-blue" />
          <Stat label="Output Tokens" value={fmtNum(stats.outputs)} accent="text-mc-accent-green" />
          <Stat label="Est. Cost" value={stats.costAvailable ? formatUSD(stats.cost) : '—'} accent="text-mc-accent-yellow" hint={stats.costAvailable ? 'across known models' : 'no priced models'} />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-mc-text-secondary mb-3">
              Tokens per day · last 14 days
            </h3>
            <LineChart
              points={dailySeries}
              seriesLabels={['Input', 'Output']}
              seriesColors={['#58a6ff', '#7ee787']}
              height={220}
              yLabel="tokens"
            />
          </div>
          <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-mc-text-secondary mb-3">By model</h3>
            <DonutChart slices={byModel} />
          </div>
        </div>

        {/* Filters */}
        <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-4 flex items-center gap-2 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-mc-text-secondary" />
          <FilterSelect label="Agent" value={agentFilter} options={agentOptions} onChange={(v) => { setAgentFilter(v); setPage(0); }} />
          <FilterSelect label="Model" value={modelFilter} options={modelOptions} onChange={(v) => { setModelFilter(v); setPage(0); }} />
          <FilterSelect label="Status" value={statusFilter} options={statusOptions} onChange={(v) => { setStatusFilter(v); setPage(0); }} />
          <div className="flex-1 min-w-[200px] flex items-center gap-1.5 px-2 py-1 rounded-md bg-mc-bg border border-mc-border ml-auto">
            <Search className="w-3.5 h-3.5 text-mc-text-secondary" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search by key, peer, channel…"
              className="flex-1 bg-transparent text-xs focus:outline-none"
            />
          </div>
          <span className="text-xs text-mc-text-secondary tabular-nums">
            {sorted.length} of {(sessions ?? []).length}
          </span>
        </div>

        {/* Table */}
        <div className="bg-mc-bg-secondary border border-mc-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-mc-bg/40 border-b border-mc-border">
                <th className="text-left p-3"><SortBtn k="agent" label="Agent" /></th>
                <th className="text-left p-3 hidden md:table-cell"><SortBtn k="model" label="Model" /></th>
                <th className="text-left p-3 hidden lg:table-cell">Kind</th>
                <th className="text-right p-3"><SortBtn k="inputTokens" label="In" /></th>
                <th className="text-right p-3"><SortBtn k="outputTokens" label="Out" /></th>
                <th className="text-right p-3 hidden md:table-cell"><SortBtn k="totalTokens" label="Total" /></th>
                <th className="text-right p-3 hidden md:table-cell"><SortBtn k="cost" label="Cost" /></th>
                <th className="text-left p-3 hidden lg:table-cell">Status</th>
                <th className="text-right p-3"><SortBtn k="updatedAt" label="Updated" /></th>
                <th className="p-3 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr><td colSpan={10} className="p-8 text-center text-mc-text-secondary text-sm">No sessions match your filters.</td></tr>
              )}
              {pageRows.map(s => {
                const cost = estimateCost({
                  model: s.model, inputTokens: s.inputTokens, outputTokens: s.outputTokens,
                  cacheReadTokens: s.cacheReadInputTokens, cacheWriteTokens: s.cacheCreationInputTokens,
                });
                const updated = ts(s.updatedAt ?? s.startedAt);
                const id = s.sessionId ?? s.id ?? s.key;
                const isOpen = expandedId === id;
                return (
                  <>
                    <tr
                      key={id}
                      className={`border-b border-mc-border/60 hover:bg-mc-bg-tertiary/40 cursor-pointer ${isOpen ? 'bg-mc-bg-tertiary/40' : ''}`}
                      onClick={() => setExpandedId(isOpen ? null : id)}
                    >
                      <td className="p-3 align-top">
                        <div className="text-sm text-mc-text font-medium capitalize">{parseAgentFromKey(s.key)}</div>
                        <div className="text-[10px] text-mc-text-secondary font-mono truncate max-w-[200px]" title={s.key}>{s.key}</div>
                      </td>
                      <td className="p-3 align-top hidden md:table-cell"><span className="text-xs font-mono text-mc-text-secondary">{shortModel(s.model)}</span></td>
                      <td className="p-3 align-top hidden lg:table-cell"><span className="text-xs text-mc-text-secondary">{sessionKindFromKey(s.key) || '—'}</span></td>
                      <td className="p-3 align-top text-right"><span className="text-xs font-mono tabular-nums text-mc-accent-blue">{fmtNum(s.inputTokens ?? 0)}</span></td>
                      <td className="p-3 align-top text-right"><span className="text-xs font-mono tabular-nums text-mc-accent-green">{fmtNum(s.outputTokens ?? 0)}</span></td>
                      <td className="p-3 align-top text-right hidden md:table-cell"><span className="text-xs font-mono tabular-nums text-mc-text">{fmtNum(s.totalTokens ?? 0)}</span></td>
                      <td className="p-3 align-top text-right hidden md:table-cell"><span className="text-xs font-mono tabular-nums text-mc-text-secondary">{formatUSD(cost)}</span></td>
                      <td className="p-3 align-top hidden lg:table-cell"><StatusPill status={s.status} /></td>
                      <td className="p-3 align-top text-right"><span className="text-[11px] text-mc-text-secondary whitespace-nowrap">{updated ? new Date(updated).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'}</span></td>
                      <td className="p-3 align-top text-mc-text-secondary">{isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</td>
                    </tr>
                    {isOpen && (
                      <tr key={`${id}-detail`} className="bg-mc-bg/40 border-b border-mc-border/60">
                        <td colSpan={10} className="p-4">
                          <SessionTranscript sessionKey={s.key} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-mc-border bg-mc-bg/40">
              <span className="text-xs text-mc-text-secondary tabular-nums">
                Page {page + 1} of {totalPages} · showing {pageRows.length} of {sorted.length}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="text-xs px-3 py-1 rounded border border-mc-border bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text disabled:opacity-30">
                  Prev
                </button>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="text-xs px-3 py-1 rounded border border-mc-border bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text disabled:opacity-30">
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtNum(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function Stat({ label, value, accent, hint }: { label: string; value: string; accent?: string; hint?: string }) {
  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-4">
      <p className="text-[10px] uppercase tracking-wider text-mc-text-secondary mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums leading-tight ${accent ?? 'text-mc-text'}`}>{value}</p>
      {hint && <p className="text-[10px] text-mc-text-secondary/70 mt-1">{hint}</p>}
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-mc-text-secondary">
      <span className="opacity-70">{label}:</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="bg-mc-bg border border-mc-border rounded px-2 py-1 text-xs text-mc-text focus:outline-none focus:border-mc-accent">
        <option value="all">All</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function StatusPill({ status }: { status?: string }) {
  if (!status) return <span className="text-xs text-mc-text-secondary">—</span>;
  const cls = status === 'failed' ? 'text-mc-accent-red bg-mc-accent-red/10 border-mc-accent-red/30'
    : status === 'done' ? 'text-mc-accent-green bg-mc-accent-green/10 border-mc-accent-green/30'
    : status === 'open' || status === 'active' ? 'text-mc-accent-blue bg-mc-accent-blue/10 border-mc-accent-blue/30'
    : 'text-mc-text-secondary bg-mc-bg-tertiary border-mc-border';
  return <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wider font-medium ${cls}`}>{status}</span>;
}
