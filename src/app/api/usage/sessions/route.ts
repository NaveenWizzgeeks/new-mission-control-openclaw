import { NextRequest, NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import type { SessionUsageEntry } from '@/lib/openclaw/client';

export const dynamic = 'force-dynamic';

function normalizeEntry(raw: unknown): SessionUsageEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const key = String(r.key ?? r.sessionKey ?? r.id ?? '');
  if (!key) return null;
  return {
    key,
    label: r.label ? String(r.label) : undefined,
    updatedAt: r.updatedAt ? String(r.updatedAt) : undefined,
    input: Number(r.input ?? r.tokens_input ?? 0),
    output: Number(r.output ?? r.tokens_output ?? 0),
    cacheRead: Number(r.cacheRead ?? r.cache_read ?? 0),
    cacheWrite: Number(r.cacheWrite ?? r.cache_write ?? 0),
    totalTokens: Number(r.totalTokens ?? r.total_tokens ?? 0),
  };
}

export async function GET(request: NextRequest) {
  const sessionKey = request.nextUrl.searchParams.get('key') ?? undefined;
  try {
    const client = getOpenClawClient();
    await client.connect();

    const raw = await client.getSessionsUsage(sessionKey ? { key: sessionKey } : undefined);

    let entries: SessionUsageEntry[] = [];
    if (Array.isArray(raw)) {
      entries = raw.map(normalizeEntry).filter(Boolean) as SessionUsageEntry[];
    } else if (raw && typeof raw === 'object') {
      const r = raw as Record<string, unknown>;
      const list = Array.isArray(r.sessions) ? r.sessions : Array.isArray(r.data) ? r.data : [];
      entries = list.map(normalizeEntry).filter(Boolean) as SessionUsageEntry[];
    }

    return NextResponse.json({ sessions: entries, total: entries.length });
  } catch (err) {
    console.error('[api/usage/sessions] gateway error:', err);
    return NextResponse.json({ error: 'gateway_unavailable', sessions: [], total: 0 }, { status: 503 });
  }
}
