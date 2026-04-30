import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { parseSchedule, nextRunAfter, describeSchedule } from '@/lib/cron/parser';

export const dynamic = 'force-dynamic';

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
  return { ...row, enabled: !!row.enabled, config, schedule_human: describeSchedule(row.schedule) };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json() as Partial<{ name: string; schedule: string; action_type: ActionType; action_config: unknown; enabled: boolean }>;
    const db = getDb();
    const existing = db.prepare(`SELECT * FROM cron_jobs WHERE id = ?`).get(id) as CronRow | undefined;
    if (!existing) return NextResponse.json({ error: 'Cron not found' }, { status: 404 });

    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name.trim()); }
    if (body.action_type !== undefined) {
      if (!ACTION_TYPES.includes(body.action_type)) {
        return NextResponse.json({ error: `action_type must be one of ${ACTION_TYPES.join(', ')}` }, { status: 400 });
      }
      updates.push('action_type = ?'); values.push(body.action_type);
    }
    if (body.action_config !== undefined) {
      const cfg = body.action_config && typeof body.action_config === 'object' ? JSON.stringify(body.action_config) : '{}';
      updates.push('action_config = ?'); values.push(cfg);
    }

    let nextRunChanged = false;
    let nextRunValue: string | null | undefined;
    if (body.schedule !== undefined) {
      try {
        const parsed = parseSchedule(body.schedule);
        nextRunValue = nextRunAfter(parsed).toISOString();
      } catch (err) {
        return NextResponse.json({ error: `Invalid schedule: ${err instanceof Error ? err.message : err}`, code: 'invalid_schedule' }, { status: 400 });
      }
      updates.push('schedule = ?'); values.push(body.schedule.trim());
      nextRunChanged = true;
    }
    if (body.enabled !== undefined) {
      updates.push('enabled = ?'); values.push(body.enabled ? 1 : 0);
      // Recompute next_run when enabling without a fresh schedule edit.
      if (body.enabled && !nextRunChanged) {
        try {
          const parsed = parseSchedule(existing.schedule);
          nextRunValue = nextRunAfter(parsed).toISOString();
          nextRunChanged = true;
        } catch { /* leave as-is */ }
      }
      if (!body.enabled) {
        nextRunValue = null;
        nextRunChanged = true;
      }
    }
    if (nextRunChanged) {
      updates.push('next_run = ?'); values.push(nextRunValue ?? null);
    }

    if (updates.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

    values.push(id);
    db.prepare(`UPDATE cron_jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const row = db.prepare(`SELECT * FROM cron_jobs WHERE id = ?`).get(id) as CronRow;
    return NextResponse.json(shape(row));
  } catch (error) {
    console.error('[Crons API] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update cron' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const db = getDb();
    const existing = db.prepare(`SELECT id FROM cron_jobs WHERE id = ?`).get(id);
    if (!existing) return NextResponse.json({ error: 'Cron not found' }, { status: 404 });
    db.prepare(`DELETE FROM cron_jobs WHERE id = ?`).run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Crons API] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete cron' }, { status: 500 });
  }
}
