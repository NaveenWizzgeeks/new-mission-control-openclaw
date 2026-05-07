'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, Loader2, Play, AlertTriangle, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface AgentMetrics {
  sessions: number;
  success_rate: number;
  avg_duration_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  avg_tokens_in: number;
  avg_tokens_out: number;
  avg_cost_usd: number;
}

interface DriftFlag {
  metric: keyof AgentMetrics;
  current: number;
  baseline: number;
  pct_change: number;
  regression: boolean;
  direction: 'higher_is_better' | 'lower_is_better' | 'neutral';
}

interface EvalRun {
  id: string;
  agent_id: string;
  agent_name: string | null;
  agent_role: string | null;
  window_start: string;
  window_end: string;
  metrics: AgentMetrics;
  baseline: AgentMetrics;
  drift_flags: DriftFlag[];
  created_at: string;
}

const METRIC_LABEL: Record<keyof AgentMetrics, string> = {
  sessions: 'Sessions',
  success_rate: 'Success rate',
  avg_duration_ms: 'Avg duration',
  p50_ms: 'p50 latency',
  p95_ms: 'p95 latency',
  p99_ms: 'p99 latency',
  avg_tokens_in: 'Avg tokens in',
  avg_tokens_out: 'Avg tokens out',
  avg_cost_usd: 'Avg cost',
};

export function EvalsDashboard() {
  const [items, setItems] = useState<EvalRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/evals');
      if (!res.ok) { setError(`Load failed (${res.status})`); return; }
      const d = await res.json();
      setItems(d.items);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runAll = async () => {
    setRunning(true);
    try {
      await fetch('/api/evals/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await load();
    } finally { setRunning(false); }
  };

  return (
    <>
      <div className="border-b border-mc-border bg-mc-bg-secondary px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-mc-accent-purple">
            <Activity className="w-5 h-5" />
            <h1 className="text-lg font-semibold text-mc-text">Agent Evals</h1>
          </div>
          <span className="text-xs text-mc-text-secondary">
            7-day rolling metrics per agent · drift vs prior 28-day baseline.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={runAll}
              disabled={running}
              className="flex items-center gap-1.5 px-2.5 min-h-9 rounded-lg border border-mc-accent/30 bg-mc-accent/10 text-xs text-mc-accent hover:bg-mc-accent/20 disabled:opacity-50"
            >
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Run all now
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
        <p className="text-[11px] text-mc-text-secondary mt-2">
          Tip: schedule recurring runs via <code className="text-mc-accent">/crons</code> with action <code>custom</code>
          {' '}pointed at <code>POST /api/evals/run</code>.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
        {error && (
          <div className="text-sm text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        {!items && !error && (
          <div className="flex items-center gap-2 text-sm text-mc-text-secondary py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}

        {items && items.length === 0 && (
          <div className="text-center text-sm text-mc-text-secondary py-12 border border-dashed border-mc-border rounded-lg">
            No eval runs yet — click <strong>Run all now</strong> to compute the first window.
          </div>
        )}

        {items && items.length > 0 && (
          <div className="space-y-3">
            {items.map(it => (
              <EvalRunCard key={it.id} run={it} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function EvalRunCard({ run }: { run: EvalRun }) {
  const flagged = run.drift_flags.filter(f => f.regression);
  return (
    <div className={`rounded-lg border ${flagged.length > 0 ? 'border-mc-accent-red/40 bg-mc-accent-red/5' : 'border-mc-border bg-mc-bg-secondary'} p-4`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-mc-text">
            {run.agent_name ?? run.agent_id.slice(0, 8)}
            {run.agent_role && <span className="text-mc-text-secondary font-normal"> · {run.agent_role}</span>}
          </h3>
          <p className="text-[10px] text-mc-text-secondary mt-0.5">
            window {new Date(run.window_start).toLocaleDateString()} → {new Date(run.window_end).toLocaleDateString()}
            · run {new Date(run.created_at).toLocaleString()}
          </p>
        </div>
        {flagged.length > 0 && (
          <span className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-mc-accent-red/15 text-mc-accent-red border border-mc-accent-red/40">
            <AlertTriangle className="w-3 h-3" /> {flagged.length} regression{flagged.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <Metric label="Sessions"   value={run.metrics.sessions.toString()}                      drift={driftFor(run.drift_flags, 'sessions')} />
        <Metric label="Success"    value={`${(run.metrics.success_rate * 100).toFixed(0)}%`}    drift={driftFor(run.drift_flags, 'success_rate')} />
        <Metric label="p50"        value={fmtMs(run.metrics.p50_ms)}                            drift={driftFor(run.drift_flags, 'p50_ms')} />
        <Metric label="p95"        value={fmtMs(run.metrics.p95_ms)}                            drift={driftFor(run.drift_flags, 'p95_ms')} />
        <Metric label="p99"        value={fmtMs(run.metrics.p99_ms)}                            drift={driftFor(run.drift_flags, 'p99_ms')} />
        <Metric label="Tokens in"  value={run.metrics.avg_tokens_in.toLocaleString()} />
        <Metric label="Tokens out" value={run.metrics.avg_tokens_out.toLocaleString()} />
        <Metric label="Avg cost"   value={`$${run.metrics.avg_cost_usd.toFixed(4)}`} />
      </div>

      {flagged.length > 0 && (
        <ul className="mt-3 space-y-1">
          {flagged.map(f => (
            <li key={f.metric} className="flex items-center gap-2 text-[11px] text-mc-accent-red">
              <AlertTriangle className="w-3 h-3" />
              <span>
                <strong>{METRIC_LABEL[f.metric]}</strong>
                {' '}regressed {(f.pct_change * 100).toFixed(1)}%
                {' '}(current {fmtSmart(f.current, f.metric)}, baseline {fmtSmart(f.baseline, f.metric)})
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metric({ label, value, drift }: { label: string; value: string; drift?: DriftFlag }) {
  let trend: React.ReactNode = null;
  if (drift && drift.baseline !== 0) {
    const pct = drift.pct_change;
    if (drift.regression) {
      trend = drift.direction === 'higher_is_better'
        ? <TrendingDown className="w-3 h-3 text-mc-accent-red" />
        : <TrendingUp className="w-3 h-3 text-mc-accent-red" />;
    } else if (Math.abs(pct) < 0.05) {
      trend = <Minus className="w-3 h-3 text-mc-text-secondary" />;
    } else {
      trend = drift.direction === 'higher_is_better'
        ? <TrendingUp className="w-3 h-3 text-mc-accent-green" />
        : <TrendingDown className="w-3 h-3 text-mc-accent-green" />;
    }
  }
  return (
    <div className="rounded border border-mc-border bg-mc-bg px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-mc-text-secondary">{label}</div>
      <div className="text-sm font-semibold text-mc-text mt-0.5 flex items-center gap-1">
        {value}
        {trend}
      </div>
    </div>
  );
}

function driftFor(flags: DriftFlag[], metric: keyof AgentMetrics): DriftFlag | undefined {
  return flags.find(f => f.metric === metric);
}

function fmtMs(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.round(n)}ms`;
}

function fmtSmart(n: number, metric: keyof AgentMetrics): string {
  if (metric === 'success_rate') return `${(n * 100).toFixed(0)}%`;
  if (metric.endsWith('_ms')) return fmtMs(n);
  return n.toLocaleString();
}
