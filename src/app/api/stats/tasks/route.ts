import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');

    const rows = workspaceId
      ? queryAll<{ status: string; count: number }>(
          'SELECT status, COUNT(*) as count FROM tasks WHERE workspace_id = ? GROUP BY status',
          [workspaceId]
        )
      : queryAll<{ status: string; count: number }>(
          'SELECT status, COUNT(*) as count FROM tasks GROUP BY status'
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
