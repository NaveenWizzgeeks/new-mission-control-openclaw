import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import type { UsageTokenSummary, UsageTokenOverview } from '@/lib/openclaw/client';

export const dynamic = 'force-dynamic';

function emptySummary(): UsageTokenSummary {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
}

function extractSummary(raw: unknown): UsageTokenSummary {
  if (!raw || typeof raw !== 'object') return emptySummary();
  const r = raw as Record<string, unknown>;
  return {
    input: Number(r.input ?? r.tokens_input ?? 0),
    output: Number(r.output ?? r.tokens_output ?? 0),
    cacheRead: Number(r.cacheRead ?? r.cache_read ?? 0),
    cacheWrite: Number(r.cacheWrite ?? r.cache_write ?? 0),
    totalTokens: Number(r.totalTokens ?? r.total_tokens ?? 0),
  };
}

async function fetchRange(client: ReturnType<typeof getOpenClawClient>, days: number): Promise<UsageTokenSummary> {
  try {
    const raw = await client.getUsageTokens({ days });
    return extractSummary(raw);
  } catch {
    return emptySummary();
  }
}

export async function GET() {
  try {
    const client = getOpenClawClient();
    await client.connect();

    const [today, week, month, total] = await Promise.all([
      fetchRange(client, 1),
      fetchRange(client, 7),
      fetchRange(client, 30),
      fetchRange(client, 365),
    ]);

    const overview: UsageTokenOverview = { today, week, month, total };
    return NextResponse.json(overview);
  } catch (err) {
    console.error('[api/usage/overview] gateway error:', err);
    return NextResponse.json(
      { error: 'gateway_unavailable', today: emptySummary(), week: emptySummary(), month: emptySummary(), total: emptySummary() },
      { status: 503 }
    );
  }
}
