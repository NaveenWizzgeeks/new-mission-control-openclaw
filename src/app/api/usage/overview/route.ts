import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import type { UsageTokenSummary, UsageTokenOverview } from '@/lib/openclaw/client';

export const dynamic = 'force-dynamic';

interface RawGatewaySession {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  updatedAt?: number;
  startedAt?: number;
  endedAt?: number;
}

function emptySummary(): UsageTokenSummary {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
}

function aggregate(sessions: RawGatewaySession[]): UsageTokenSummary {
  return sessions.reduce<UsageTokenSummary>(
    (acc, s) => ({
      input: acc.input + (s.inputTokens ?? 0),
      output: acc.output + (s.outputTokens ?? 0),
      cacheRead: acc.cacheRead + (s.cacheReadInputTokens ?? 0),
      cacheWrite: acc.cacheWrite + (s.cacheCreationInputTokens ?? 0),
      totalTokens: acc.totalTokens + (s.totalTokens ?? 0),
    }),
    emptySummary()
  );
}

function extractSessions(raw: unknown): RawGatewaySession[] {
  // Gateway returns { ts, count, sessions: [...] }; tolerate a flat array too.
  if (Array.isArray(raw)) return raw as RawGatewaySession[];
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.sessions)) return r.sessions as RawGatewaySession[];
  }
  return [];
}

export async function GET() {
  try {
    const client = getOpenClawClient();
    await client.connect();

    const raw = await client.listSessions();
    const sessions = extractSessions(raw);

    // Bucket by session activity (updatedAt). A session's totalTokens is its
    // lifetime usage, so "today" really means "tokens consumed by sessions
    // touched in the last 24h" — close enough for a dashboard widget.
    const now = Date.now();
    const within = (days: number) =>
      sessions.filter(s => {
        const ts = s.updatedAt ?? s.endedAt ?? s.startedAt ?? 0;
        return ts > 0 && ts >= now - days * 86_400_000;
      });

    const overview: UsageTokenOverview = {
      today: aggregate(within(1)),
      week: aggregate(within(7)),
      month: aggregate(within(30)),
      total: aggregate(sessions),
    };

    return NextResponse.json(overview);
  } catch (err) {
    console.error('[api/usage/overview] gateway error:', err);
    return NextResponse.json(
      {
        error: 'gateway_unavailable',
        today: emptySummary(),
        week: emptySummary(),
        month: emptySummary(),
        total: emptySummary(),
      },
      { status: 503 }
    );
  }
}
