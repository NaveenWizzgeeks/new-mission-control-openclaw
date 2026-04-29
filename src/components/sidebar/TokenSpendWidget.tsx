'use client';

import { useState, useEffect, useCallback } from 'react';
import { Zap, RefreshCw, WifiOff } from 'lucide-react';
import type { UsageTokenOverview, UsageTokenSummary } from '@/lib/openclaw/client';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function emptySummary(): UsageTokenSummary {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
}

function emptyOverview(): UsageTokenOverview {
  return { today: emptySummary(), week: emptySummary(), month: emptySummary(), total: emptySummary() };
}

type Range = 'today' | 'week' | 'month' | 'total';

const RANGE_LABELS: Record<Range, string> = {
  today: 'Today',
  week: '7d',
  month: '30d',
  total: 'All',
};

export function TokenSpendWidget() {
  const [overview, setOverview] = useState<UsageTokenOverview>(emptyOverview());
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [range, setRange] = useState<Range>('today');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/usage/overview');
      if (res.status === 503) {
        setOffline(true);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setOverview(data);
        setOffline(false);
      }
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const summary = overview[range];

  return (
    <div className="px-3 pb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-mc-text-secondary uppercase tracking-wider">
          <Zap className="w-3.5 h-3.5" />
          Tokens
        </div>
        <button onClick={load} className="text-mc-text-secondary hover:text-mc-text" title="Refresh">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Range picker */}
      <div className="flex gap-0.5 mb-3 bg-mc-bg rounded-lg p-0.5">
        {(Object.keys(RANGE_LABELS) as Range[]).map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`flex-1 text-xs py-1 rounded-md transition-colors ${
              range === r
                ? 'bg-mc-bg-tertiary text-mc-text font-medium'
                : 'text-mc-text-secondary hover:text-mc-text'
            }`}
          >
            {RANGE_LABELS[r]}
          </button>
        ))}
      </div>

      {offline ? (
        <div className="flex flex-col items-center gap-1.5 py-3 text-mc-text-secondary">
          <WifiOff className="w-5 h-5" />
          <span className="text-xs">Gateway offline</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-mc-text-secondary">Total</span>
            <span className="font-mono font-medium text-mc-text">{formatTokens(summary.totalTokens)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-mc-text-secondary">Input</span>
            <span className="font-mono text-mc-text-secondary">{formatTokens(summary.input)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-mc-text-secondary">Output</span>
            <span className="font-mono text-mc-text-secondary">{formatTokens(summary.output)}</span>
          </div>
          {(summary.cacheRead + summary.cacheWrite) > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-mc-text-secondary">Cache</span>
              <span className="font-mono text-mc-text-secondary">{formatTokens(summary.cacheRead + summary.cacheWrite)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
