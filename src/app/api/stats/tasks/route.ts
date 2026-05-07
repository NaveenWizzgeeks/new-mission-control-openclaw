import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');

    // Exclude mission-parent tasks (convoy shells) from stat counts. The
    // "In flight" tile asks "how much real work is moving?" — a mission
    // parent at status='planning' is the mission itself, not a unit of work.
    // Without this exclusion, every active mission inflates the counter by 1,
    // which produced the "1 in flight when nothing's running" bug.
    const exclusion = `
      NOT EXISTS (SELECT 1 FROM convoys c WHERE c.parent_task_id = tasks.id)
    `;
    const rows = workspaceId
      ? queryAll<{ status: string; count: number }>(
          `SELECT status, COUNT(*) as count FROM tasks
           WHERE workspace_id = ? AND ${exclusion}
           GROUP BY status`,
          [workspaceId]
        )
      : queryAll<{ status: string; count: number }>(
          `SELECT status, COUNT(*) as count FROM tasks
           WHERE ${exclusion}
           GROUP BY status`
        );

    const by_status: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      by_status[row.status] = row.count;
      total += row.count;
    }

    return NextResponse.json({ total, by_status });
  } catch (error) {
    console.error('Failed to fetch task stats:', error);
    return NextResponse.json({ error: 'Failed to fetch task stats' }, { status: 500 });
  }
}
