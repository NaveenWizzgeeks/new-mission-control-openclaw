import { NextRequest, NextResponse } from 'next/server';
import { getLatestEval, listLatestEvalPerAgent } from '@/lib/evals/runner';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agent_id');
  if (agentId) {
    const latest = getLatestEval(agentId);
    if (!latest) {
      return NextResponse.json({ error: 'No eval runs for this agent yet', code: 'no_runs' }, { status: 404 });
    }
    return NextResponse.json(latest);
  }
  return NextResponse.json({ items: listLatestEvalPerAgent() });
}
