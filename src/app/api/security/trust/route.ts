import { NextRequest, NextResponse } from 'next/server';
import { computeTrustScore, listTrustScores } from '@/lib/security/trust';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agent_id');
  if (agentId) {
    return NextResponse.json(computeTrustScore(agentId));
  }
  return NextResponse.json({ items: listTrustScores() });
}
