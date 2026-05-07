import { NextRequest, NextResponse } from 'next/server';
import { runEval, runEvalsForAllAgents } from '@/lib/evals/runner';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: { agent_id?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body.agent_id) {
    const result = runEval(body.agent_id);
    return NextResponse.json({ ok: true, mode: 'single', result });
  }
  const summary = runEvalsForAllAgents();
  return NextResponse.json({ ok: true, mode: 'all', ...summary });
}
