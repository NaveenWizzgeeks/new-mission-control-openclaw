import { NextRequest, NextResponse } from 'next/server';
import { syncMissionToGitHub } from '@/lib/github/sync';

export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest, { params }: { params: { missionId: string } }) {
  const result = await syncMissionToGitHub(params.missionId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: 'sync_failed' }, { status: 502 });
  }
  return NextResponse.json(result);
}
