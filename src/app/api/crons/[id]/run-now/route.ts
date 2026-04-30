import { NextRequest, NextResponse } from 'next/server';
import { runJobNow } from '@/lib/cron/runner';

export const dynamic = 'force-dynamic';

// POST /api/crons/[id]/run-now — fire the action outside the schedule.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await runJobNow(id);
    if (!result.ok && result.status === 'not_found') {
      return NextResponse.json({ error: 'Cron not found' }, { status: 404 });
    }
    if (!result.ok && result.status === 'already_running') {
      return NextResponse.json({ error: 'Already running', code: 'in_flight' }, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Crons API] run-now failed:', error);
    return NextResponse.json({ error: 'Failed to run', detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
