'use client';

import { useEffect, useState, useCallback } from 'react';
import { Zap } from 'lucide-react';
import { SidebarSection } from './SidebarSection';

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

export function SidebarTokens() {
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

  const todayTotal = overview?.today.totalTokens ?? 0;

  return (
    <SidebarSection
      title="Tokens"
      storageKey="mc-sidebar-tokens-open"
      icon={<Zap className="w-3.5 h-3.5" />}
      count={overview ? formatNum(todayTotal) : '—'}
      defaultOpen={false}
    >
      {unavailable ? (
        <p className="px-2 py-1 text-xs text-mc-text-secondary">Gateway offline</p>
      ) : overview === null ? (
        <p className="px-2 py-1 text-xs text-mc-text-secondary">Loading…</p>
      ) : (
        <div className="px-2 py-1 space-y-1.5 text-xs">
          <Row label="Today" value={overview.today.totalTokens} />
          <Row label="7 days" value={overview.week.totalTokens} />
          <Row label="30 days" value={overview.month.totalTokens} />
          <div className="pt-1 mt-1 border-t border-mc-border/50 text-[10px] text-mc-text-secondary">
            <div className="flex justify-between">
              <span>in / out</span>
              <span className="font-mono">
                {formatNum(overview.today.input)} / {formatNum(overview.today.output)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>cache</span>
              <span className="font-mono">
                {formatNum(overview.today.cacheRead + overview.today.cacheWrite)}
              </span>
            </div>
          </div>
        </div>
      )}
    </SidebarSection>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-mc-text-secondary">{label}</span>
      <span className="font-mono text-mc-text tabular-nums">{formatNum(value)}</span>
    </div>
  );
}
