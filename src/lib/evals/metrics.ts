/**
 * Per-agent metric computation over a date window.
 *
 * Pulls from openclaw_sessions (latency, success rate) and cost_events
 * (token usage). All metric values are numbers; absent data → 0.
 *
 * Drift detection: each metric in the current window is compared against
 * the same metric on the prior baseline window. A regression is flagged
 * when the metric crosses a regression threshold:
 *
 *   higher-is-better metrics (success_rate, sessions): flagged if dropped >10%
 *   lower-is-better metrics (latency): flagged if increased >15%
 */

import { queryAll } from '@/lib/db';

export interface AgentMetrics {
  sessions: number;
  success_rate: number; // 0-1
  avg_duration_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  avg_tokens_in: number;
  avg_tokens_out: number;
  avg_cost_usd: number;
}

export interface DriftFlag {
  metric: keyof AgentMetrics;
  current: number;
  baseline: number;
  pct_change: number;
  regression: boolean;
  direction: 'higher_is_better' | 'lower_is_better' | 'neutral';
}

export const EMPTY_METRICS: AgentMetrics = {
  sessions: 0,
  success_rate: 0,
  avg_duration_ms: 0,
  p50_ms: 0,
  p95_ms: 0,
  p99_ms: 0,
  avg_tokens_in: 0,
  avg_tokens_out: 0,
  avg_cost_usd: 0,
};

const HIGHER_IS_BETTER: Array<keyof AgentMetrics> = ['sessions', 'success_rate'];
const LOWER_IS_BETTER: Array<keyof AgentMetrics> = ['avg_duration_ms', 'p50_ms', 'p95_ms', 'p99_ms'];
const REGRESSION_THRESHOLD_DROP = 0.10; // 10% drop on higher-is-better
const REGRESSION_THRESHOLD_RISE = 0.15; // 15% rise on lower-is-better

/**
 * Compute metrics for a single agent over [start, end). Both bounds are ISO strings.
 */
export function computeMetrics(agentId: string, startISO: string, endISO: string): AgentMetrics {
  // Latency from openclaw_sessions where ended_at is set.
  const durations = queryAll<{ ms: number }>(`
    SELECT (julianday(ended_at) - julianday(created_at)) * 86400000 AS ms
    FROM openclaw_sessions
    WHERE agent_id = ?
      AND created_at >= ? AND created_at < ?
      AND ended_at IS NOT NULL
    ORDER BY ms ASC
  `, [agentId, startISO, endISO]).map(r => r.ms).filter(n => Number.isFinite(n) && n >= 0);

  const sessionCount = (queryAll<{ n: number }>(`
    SELECT COUNT(*) AS n FROM openclaw_sessions
    WHERE agent_id = ? AND created_at >= ? AND created_at < ?
  `, [agentId, startISO, endISO])[0]?.n) ?? 0;

  const completedCount = (queryAll<{ n: number }>(`
    SELECT COUNT(*) AS n FROM openclaw_sessions
    WHERE agent_id = ? AND created_at >= ? AND created_at < ? AND status = 'completed'
  `, [agentId, startISO, endISO])[0]?.n) ?? 0;

  const successRate = sessionCount > 0 ? completedCount / sessionCount : 0;

  // Tokens + cost from cost_events.
  const cost = queryAll<{ tin: number; tout: number; usd: number; n: number }>(`
    SELECT
      COALESCE(SUM(tokens_input), 0) AS tin,
      COALESCE(SUM(tokens_output), 0) AS tout,
      COALESCE(SUM(cost_usd), 0) AS usd,
      COUNT(*) AS n
    FROM cost_events
    WHERE agent_id = ? AND created_at >= ? AND created_at < ?
  `, [agentId, startISO, endISO])[0];

  const events = cost?.n ?? 0;

  return {
    sessions: sessionCount,
    success_rate: round(successRate, 3),
    avg_duration_ms: durations.length > 0 ? round(avg(durations), 0) : 0,
    p50_ms: round(percentile(durations, 0.5), 0),
    p95_ms: round(percentile(durations, 0.95), 0),
    p99_ms: round(percentile(durations, 0.99), 0),
    avg_tokens_in: events > 0 ? round((cost?.tin ?? 0) / events, 0) : 0,
    avg_tokens_out: events > 0 ? round((cost?.tout ?? 0) / events, 0) : 0,
    avg_cost_usd: events > 0 ? round((cost?.usd ?? 0) / events, 4) : 0,
  };
}

export function detectDrift(current: AgentMetrics, baseline: AgentMetrics): DriftFlag[] {
  const out: DriftFlag[] = [];
  for (const k of HIGHER_IS_BETTER) {
    const c = current[k];
    const b = baseline[k];
    if (b === 0) continue; // no baseline, can't compare
    const pct = (c - b) / b;
    out.push({
      metric: k,
      current: c,
      baseline: b,
      pct_change: round(pct, 3),
      regression: pct < -REGRESSION_THRESHOLD_DROP,
      direction: 'higher_is_better',
    });
  }
  for (const k of LOWER_IS_BETTER) {
    const c = current[k];
    const b = baseline[k];
    if (b === 0) continue;
    const pct = (c - b) / b;
    out.push({
      metric: k,
      current: c,
      baseline: b,
      pct_change: round(pct, 3),
      regression: pct > REGRESSION_THRESHOLD_RISE,
      direction: 'lower_is_better',
    });
  }
  return out;
}

// ---------- helpers ----------

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  const w = i - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function round(n: number, decimals: number): number {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
