import { NextRequest, NextResponse } from 'next/server';
import { listFindings } from '@/lib/security/store';
import type { Severity } from '@/lib/security/scanner';
import type { FindingSource } from '@/lib/security/store';

export const dynamic = 'force-dynamic';

const SEVERITIES: Severity[] = ['critical', 'warning', 'info'];
const SOURCES: FindingSource[] = ['chat_inbound', 'chat_outbound', 'mcp_call', 'skill_install'];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sev = searchParams.get('severity') as Severity | null;
  const src = searchParams.get('source') as FindingSource | null;
  const resolvedRaw = searchParams.get('resolved');
  const agentId = searchParams.get('agent_id') ?? undefined;
  const limit = numParam(searchParams.get('limit'), 200, 1000);

  const items = listFindings({
    agentId,
    severity: sev && SEVERITIES.includes(sev) ? sev : undefined,
    source: src && SOURCES.includes(src) ? src : undefined,
    resolved: resolvedRaw === 'true' ? true : resolvedRaw === 'false' ? false : undefined,
    limit,
  });

  return NextResponse.json({ items, total: items.length });
}

function numParam(raw: string | null, def: number, max: number): number {
  const n = raw ? Number(raw) : def;
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}
