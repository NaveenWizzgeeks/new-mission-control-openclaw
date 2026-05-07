import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getMissionControlUrl } from '@/lib/config';

export const dynamic = 'force-dynamic';

interface ZombieRow {
  task_id: string;
  agent_id: string;
  health_state: string;
  task_status: string;
  minutes_idle: number;
}

const STALE_MIN_MINUTES = 30;

/**
 * Phase 13O.3: scan for tasks where:
 *   - status is in_progress or assigned
 *   - assigned agent_health is zombie/stuck
 *   - task hasn't been updated in >30 min
 *
 * For each such task, hit the sync-from-gateway POST. If the gateway has
 * status=done, the task auto-completes and the next subtask dispatches.
 *
 * Wire this on a recurring schedule via /crons:
 *   action: custom · URL: /api/admin/recover-zombie-tasks · method: POST · every 5m
 */
export async function POST() {
  const candidates = queryAll<ZombieRow>(`
    SELECT
      t.id AS task_id,
      t.assigned_agent_id AS agent_id,
      ah.health_state AS health_state,
      t.status AS task_status,
      ROUND((julianday('now') - julianday(t.updated_at)) * 24 * 60, 0) AS minutes_idle
    FROM tasks t
    JOIN agent_health ah ON ah.agent_id = t.assigned_agent_id
    WHERE t.status IN ('in_progress', 'assigned')
      AND ah.health_state IN ('zombie', 'stuck', 'stalled')
      AND (julianday('now') - julianday(t.updated_at)) * 24 * 60 >= ?
  `, [STALE_MIN_MINUTES]);

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, recovered: 0, results: [] });
  }

  const base = getMissionControlUrl();
  const results: Array<{ task_id: string; action: string; minutes: number; detail?: string }> = [];

  for (const c of candidates) {
    try {
      const res = await fetch(`${base}/api/tasks/${c.task_id}/sync-from-gateway`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => ({}));
      results.push({
        task_id: c.task_id,
        action: data.action ?? `http_${res.status}`,
        minutes: c.minutes_idle,
        detail: data.error ?? data.reason,
      });
    } catch (err) {
      results.push({
        task_id: c.task_id,
        action: 'error',
        minutes: c.minutes_idle,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const recovered = results.filter(r => r.action === 'marked_done').length;
  return NextResponse.json({ ok: true, scanned: candidates.length, recovered, results });
}

/** Quick GET to preview what WOULD be touched without mutating anything. */
export async function GET() {
  const candidates = queryAll<ZombieRow>(`
    SELECT
      t.id AS task_id,
      t.assigned_agent_id AS agent_id,
      ah.health_state AS health_state,
      t.status AS task_status,
      ROUND((julianday('now') - julianday(t.updated_at)) * 24 * 60, 0) AS minutes_idle
    FROM tasks t
    JOIN agent_health ah ON ah.agent_id = t.assigned_agent_id
    WHERE t.status IN ('in_progress', 'assigned')
      AND ah.health_state IN ('zombie', 'stuck', 'stalled')
      AND (julianday('now') - julianday(t.updated_at)) * 24 * 60 >= ?
  `, [STALE_MIN_MINUTES]);
  return NextResponse.json({ count: candidates.length, items: candidates });
}
