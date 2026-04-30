'use client';

import { useCallback, useEffect, useState } from 'react';
import { Zap } from 'lucide-react';

interface TokenSummary {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

interface TokenOverview {
  today: TokenSummary;
  week: TokenSummary;
  month: TokenSummary;
  total: TokenSummary;
}

const POLL_MS = 30_000;

function formatNum(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export function TokenUsageCard() {
  const [overview, setOverview] = useState<TokenOverview | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/usage/overview');
      if (res.ok) {
        setOverview(await res.json());
        setUnavailable(false);
      } else if (res.status === 503) {
        setUnavailable(true);
      }
    } catch {
      setUnavailable(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5 flex flex-col max-h-[28rem]">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-mc-accent-yellow" />
          <p className="text-sm font-medium uppercase tracking-wider text-mc-text-secondary">Token Usage</p>
        </div>
      </div>

      {unavailable ? (
        <p className="text-mc-text-secondary text-sm">Gateway offline — usage unavailable</p>
      ) : overview === null ? (
        <div className="space-y-3">
          <div className="h-12 rounded-lg bg-mc-bg-tertiary animate-pulse" />
          <div className="h-20 rounded-lg bg-mc-bg-tertiary animate-pulse" />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-mc-text-secondary uppercase tracking-wider mb-1">Today</p>
            <p className="text-3xl font-bold tabular-nums">
              {formatNum(overview.today.totalTokens)}
            </p>
            <SplitBar summary={overview.today} />
          </div>

          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-mc-border">
            <Stat label="7d" value={overview.week.totalTokens} />
            <Stat label="30d" value={overview.month.totalTokens} />
            <Stat label="All time" value={overview.total.totalTokens} />
          </div>

          <div className="pt-3 border-t border-mc-border space-y-1.5 text-xs">
            <Row label="Input" value={overview.today.input} accent="text-mc-accent-blue" />
            <Row label="Output" value={overview.today.output} accent="text-mc-accent-green" />
            <Row
              label="Cache (read+write)"
              value={overview.today.cacheRead + overview.today.cacheWrite}
              accent="text-mc-accent-purple"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[10px] text-mc-text-secondary uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold tabular-nums">{formatNum(value)}</p>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-mc-text-secondary">{label}</span>
      <span className={`font-mono tabular-nums ${accent}`}>{formatNum(value)}</span>
    </div>
  );
}

function SplitBar({ summary }: { summary: TokenSummary }) {
  const total = summary.totalTokens || 1;
  const cache = summary.cacheRead + summary.cacheWrite;
  const inputPct = (summary.input / total) * 100;
  const outputPct = (summary.output / total) * 100;
  const cachePct = (cache / total) * 100;

  return (
    <div className="mt-2 flex h-1.5 rounded-full overflow-hidden bg-mc-bg-tertiary">
      <div className="bg-mc-accent-blue" style={{ width: `${inputPct}%` }} title={`Input ${formatNum(summary.input)}`} />
      <div className="bg-mc-accent-green" style={{ width: `${outputPct}%` }} title={`Output ${formatNum(summary.output)}`} />
      <div className="bg-mc-accent-purple" style={{ width: `${cachePct}%` }} title={`Cache ${formatNum(cache)}`} />
    </div>
  );
}
