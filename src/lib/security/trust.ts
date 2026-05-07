/**
 * Per-agent trust score (0-100). Inspired by builderz-labs/mission-control's
 * trust posture model.
 *
 * Score = max(0, 100 − Σ severity_weight × time_decay)
 *
 * - critical: −20 weight, 14-day half-life
 * - warning : −5  weight, 7-day half-life
 * - info    : −1  weight, 3-day half-life
 *
 * Resolved findings count at half their original weight (acknowledgement
 * doesn't fully erase signal that the issue happened).
 */

import { queryAll, queryOne } from '@/lib/db';
import type { Severity } from './scanner';

const WEIGHTS: Record<Severity, number> = { critical: 20, warning: 5, info: 1 };
const HALF_LIFE_DAYS: Record<Severity, number> = { critical: 14, warning: 7, info: 3 };
const RESOLVED_DISCOUNT = 0.5;

export interface TrustScore {
  agent_id: string;
  agent_name: string | null;
  score: number;       // 0-100
  band: 'high' | 'medium' | 'low';
  recent_critical: number;
  recent_warning: number;
  recent_info: number;
  total_findings: number;
}

interface FindingScalar {
  severity: Severity;
  resolved: number;
  ageDays: number;
}

export function computeTrustScore(agentId: string): TrustScore {
  const agent = queryOne<{ id: string; name: string | null }>(
    `SELECT id, name FROM agents WHERE id = ?`,
    [agentId],
  );

  const rows = queryAll<FindingScalar>(
    `SELECT severity, resolved,
            (julianday('now') - julianday(created_at)) AS ageDays
     FROM security_findings
     WHERE agent_id = ?`,
    [agentId],
  );

  let penalty = 0;
  let critical = 0, warning = 0, info = 0;
  for (const r of rows) {
    const w = WEIGHTS[r.severity] ?? 0;
    const hl = HALF_LIFE_DAYS[r.severity] ?? 7;
    const decay = Math.pow(0.5, Math.max(0, r.ageDays) / hl);
    const factor = r.resolved ? RESOLVED_DISCOUNT : 1;
    penalty += w * decay * factor;
    if (r.severity === 'critical') critical += 1;
    else if (r.severity === 'warning') warning += 1;
    else info += 1;
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const band: TrustScore['band'] = score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';

  return {
    agent_id: agentId,
    agent_name: agent?.name ?? null,
    score,
    band,
    recent_critical: critical,
    recent_warning: warning,
    recent_info: info,
    total_findings: rows.length,
  };
}

export function listTrustScores(): TrustScore[] {
  const agents = queryAll<{ id: string }>(`SELECT id FROM agents ORDER BY name`);
  return agents.map(a => computeTrustScore(a.id));
}
