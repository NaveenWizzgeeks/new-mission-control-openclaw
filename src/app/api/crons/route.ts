import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDb, queryAll } from '@/lib/db';
import { parseSchedule, nextRunAfter, describeSchedule } from '@/lib/cron/parser';
import { startCronRunner } from '@/lib/cron/runner';

export const dynamic = 'force-dynamic';

// Self-start the cron runner on first import of any /api/crons route.
// (Next.js doesn't have a process-startup hook; this is the cleanest stand-in
// — and it's idempotent inside startCronRunner().)
startCronRunner();

const ACTION_TYPES = ['codebase_scan', 'memory_summarize', 'agent_health_check', 'auto_propose', 'custom'] as const;
type ActionType = typeof ACTION_TYPES[number];

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
  created_at: string;
}

function shape(row: CronRow) {
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(row.action_config); } catch { /* ignore */ }
  return {
    ...row,
    enabled: !!row.enabled,
    config,
    schedule_human: describeSchedule(row.schedule),
  };
}

export async function GET() {
  const rows = queryAll<CronRow>(
    `SELECT id, name, schedule, action_type, action_config, last_run, last_run_status, next_run, enabled, created_at
     FROM cron_jobs ORDER BY enabled DESC, created_at ASC`
  );
  return NextResponse.json(rows.map(shape));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, schedule, action_type, action_config, enabled } = body as {
      name?: string; schedule?: string; action_type?: string; action_config?: unknown; enabled?: boolean;
    };

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name is required', code: 'validation_failed' }, { status: 400 });
    }
    if (!schedule || typeof schedule !== 'string') {
      return NextResponse.json({ error: 'schedule is required', code: 'validation_failed' }, { status: 400 });
    }
    if (!action_type || !ACTION_TYPES.includes(action_type as ActionType)) {
      return NextResponse.json({ error: `action_type must be one of: ${ACTION_TYPES.join(', ')}`, code: 'validation_failed' }, { status: 400 });
    }

    let parsed;
    try {
      parsed = parseSchedule(schedule);
    } catch (err) {
      return NextResponse.json({ error: `Invalid schedule: ${err instanceof Error ? err.message : err}`, code: 'invalid_schedule' }, { status: 400 });
    }

    const id = uuidv4();
    const cfg = action_config && typeof action_config === 'object' ? JSON.stringify(action_config) : '{}';
    const isEnabled = enabled === false ? 0 : 1;
    const next = isEnabled ? nextRunAfter(parsed).toISOString() : null;

    const db = getDb();
    db.prepare(`
      INSERT INTO cron_jobs (id, name, schedule, action_type, action_config, enabled, next_run, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, name.trim(), schedule.trim(), action_type, cfg, isEnabled, next);

    const row = db.prepare(`SELECT * FROM cron_jobs WHERE id = ?`).get(id) as CronRow;
    return NextResponse.json(shape(row), { status: 201 });
  } catch (error) {
    console.error('[Crons API] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create cron', code: 'internal_error' }, { status: 500 });
  }
}
