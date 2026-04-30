/**
 * Cron runner singleton. Self-starts on first import via startCronRunner().
 *
 * A 30s tick scans cron_jobs for rows where enabled=1 AND next_run <= now,
 * dispatches their action, then recomputes next_run from `nextRunAfter`.
 *
 * Concurrency: per-job in-flight set so a slow action doesn't pile up if
 * the next tick fires while we're still working. Across the process, the
 * tick itself is guarded by `isTicking` so two overlapping timers don't
 * step on each other.
 */

import { getDb, queryAll, run } from '@/lib/db';
import { parseSchedule, nextRunAfter } from './parser';
import { dispatchAction, type ActionType } from './actions';

const TICK_INTERVAL_MS = 30_000;

interface CronRow {
  id: string;
  name: string;
  schedule: string;
  action_type: ActionType;
  action_config: string;
  last_run: string | null;
  last_run_status: string | null;
  next_run: string | null;
  enabled: number;
}

let timer: NodeJS.Timeout | null = null;
let isTicking = false;
const inFlight = new Set<string>();

export function isCronRunnerStarted(): boolean {
  return timer !== null;
}

export function startCronRunner(): void {
  if (timer) return;
  // First pass: backfill next_run for any row that's missing one.
  try { backfillNextRun(); } catch (err) { console.error('[Cron] backfill failed:', err); }
  // Kick off the tick. Prime once now in case anything is overdue.
  timer = setInterval(tick, TICK_INTERVAL_MS);
  // Soft-prime: don't await; lets module imports return quickly.
  setTimeout(() => { tick().catch(err => console.error('[Cron] initial tick failed:', err)); }, 1000);
  console.log(`[Cron] runner started (tick=${TICK_INTERVAL_MS}ms)`);
}

export function stopCronRunner(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[Cron] runner stopped');
  }
}

function backfillNextRun(): void {
  const rows = queryAll<{ id: string; schedule: string; next_run: string | null; enabled: number }>(
    `SELECT id, schedule, next_run, enabled FROM cron_jobs WHERE enabled = 1`
  );
  const now = new Date();
  for (const r of rows) {
    if (r.next_run) continue;
    try {
      const parsed = parseSchedule(r.schedule);
      const next = nextRunAfter(parsed, now);
      run(`UPDATE cron_jobs SET next_run = ? WHERE id = ?`, [next.toISOString(), r.id]);
    } catch (err) {
      console.error(`[Cron] backfill skipped ${r.id} (${r.schedule}):`, err);
    }
  }
}

async function tick(): Promise<void> {
  if (isTicking) return;
  isTicking = true;
  try {
    const now = new Date();
    const due = queryAll<CronRow>(
      `SELECT id, name, schedule, action_type, action_config,
              last_run, last_run_status, next_run, enabled
       FROM cron_jobs
       WHERE enabled = 1
         AND next_run IS NOT NULL
         AND next_run <= ?
       ORDER BY next_run ASC`,
      [now.toISOString()]
    );
    for (const job of due) {
      if (inFlight.has(job.id)) continue;
      void runOne(job, now);
    }
  } finally {
    isTicking = false;
  }
}

async function runOne(job: CronRow, firedAt: Date): Promise<void> {
  inFlight.add(job.id);
  try {
    const config = parseConfig(job.action_config);
    const result = await dispatchAction(job.action_type, {
      jobId: job.id,
      jobName: job.name,
      config,
      lastRun: job.last_run,
    });

    let next: string | null = null;
    try {
      const parsed = parseSchedule(job.schedule);
      next = nextRunAfter(parsed, firedAt).toISOString();
    } catch (err) {
      // Bad schedule — disable the job so it doesn't keep failing.
      console.error(`[Cron] disabling ${job.id} (${job.name}); schedule invalid:`, err);
      run(
        `UPDATE cron_jobs SET enabled = 0, last_run = ?, last_run_status = ? WHERE id = ?`,
        [firedAt.toISOString(), 'disabled: invalid schedule', job.id]
      );
      return;
    }

    run(
      `UPDATE cron_jobs SET last_run = ?, last_run_status = ?, next_run = ? WHERE id = ?`,
      [firedAt.toISOString(), serializeStatus(result), next, job.id]
    );
  } catch (err) {
    console.error(`[Cron] runOne ${job.id} unexpected error:`, err);
    try {
      run(
        `UPDATE cron_jobs SET last_run = ?, last_run_status = ? WHERE id = ?`,
        [firedAt.toISOString(), `error: ${err instanceof Error ? err.message : String(err)}`, job.id]
      );
    } catch { /* ignore */ }
  } finally {
    inFlight.delete(job.id);
  }
}

function parseConfig(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function serializeStatus(r: { ok: boolean; message?: string; error?: string }): string {
  if (r.ok) return r.message ? `success: ${r.message}` : 'success';
  return r.error ? `error: ${r.error}` : 'error';
}

/**
 * Manual fire for "Run now" — dispatches outside the schedule. Updates
 * last_run/last_run_status but does NOT advance next_run (so the schedule
 * keeps its rhythm).
 */
export async function runJobNow(jobId: string): Promise<{ ok: boolean; status: string }> {
  const job = queryAll<CronRow>(`SELECT * FROM cron_jobs WHERE id = ?`, [jobId])[0];
  if (!job) return { ok: false, status: 'not_found' };
  if (inFlight.has(job.id)) return { ok: false, status: 'already_running' };
  const firedAt = new Date();
  inFlight.add(job.id);
  try {
    const result = await dispatchAction(job.action_type, {
      jobId: job.id,
      jobName: job.name,
      config: parseConfig(job.action_config),
      lastRun: job.last_run,
    });
    run(
      `UPDATE cron_jobs SET last_run = ?, last_run_status = ? WHERE id = ?`,
      [firedAt.toISOString(), serializeStatus(result), job.id]
    );
    return { ok: result.ok, status: serializeStatus(result) };
  } finally {
    inFlight.delete(job.id);
  }
}
