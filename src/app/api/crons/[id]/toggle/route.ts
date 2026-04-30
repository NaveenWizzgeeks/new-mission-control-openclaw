import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { parseSchedule, nextRunAfter } from '@/lib/cron/parser';

export const dynamic = 'force-dynamic';

interface CronRow { id: string; schedule: string; enabled: number }

// PATCH /api/crons/[id]/toggle — flip enabled, recompute next_run when enabling
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const db = getDb();
    const row = db.prepare(`SELECT id, schedule, enabled FROM cron_jobs WHERE id = ?`).get(id) as CronRow | undefined;
    if (!row) return NextResponse.json({ error: 'Cron not found' }, { status: 404 });

    const next = row.enabled ? 0 : 1;
    let nextRun: string | null = null;
    if (next === 1) {
      try {
        const parsed = parseSchedule(row.schedule);
        nextRun = nextRunAfter(parsed).toISOString();
      } catch (err) {
        return NextResponse.json({
          error: `Cannot enable: schedule is invalid (${err instanceof Error ? err.message : err})`,
          code: 'invalid_schedule',
        }, { status: 400 });
      }
    }

    db.prepare(`UPDATE cron_jobs SET enabled = ?, next_run = ? WHERE id = ?`).run(next, nextRun, id);
    return NextResponse.json({ ok: true, enabled: !!next, next_run: nextRun });
  } catch (error) {
    console.error('[Crons API] toggle failed:', error);
    return NextResponse.json({ error: 'Failed to toggle' }, { status: 500 });
  }
}
