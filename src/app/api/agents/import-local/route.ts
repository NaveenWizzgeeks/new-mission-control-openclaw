import { NextRequest, NextResponse } from 'next/server';
import { discoverLocalAgents, type DiscoveredAgent, type AgentSource } from '@/lib/local-agents/scanner';
import { importLocalAgent } from '@/lib/local-agents/import';

export const dynamic = 'force-dynamic';

const ALLOWED: AgentSource[] = ['claude', 'codex', 'agents', 'openclaw'];

/**
 * Body shape:
 *   { source: 'claude'|'codex'|'agents'|'openclaw', path: '<absolute path>' }
 *
 * We re-discover server-side (don't trust client-provided soul content) and
 * match by (source + path). Returns the import result + the persisted agent_id.
 */
export async function POST(request: NextRequest) {
  let body: { source?: string; path?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'validation_failed' }, { status: 400 });
  }

  const source = body.source as AgentSource | undefined;
  const targetPath = body.path?.trim();
  if (!source || !ALLOWED.includes(source)) {
    return NextResponse.json({ error: 'source must be one of ' + ALLOWED.join(', '), code: 'validation_failed' }, { status: 400 });
  }
  if (!targetPath) {
    return NextResponse.json({ error: 'path is required', code: 'validation_failed' }, { status: 400 });
  }

  const { agents } = discoverLocalAgents();
  const found: DiscoveredAgent | undefined = agents.find(a => a.source === source && a.path === targetPath);
  if (!found) {
    return NextResponse.json({ error: 'No discovered agent matched the given source+path', code: 'not_found' }, { status: 404 });
  }

  const result = importLocalAgent(found);
  return NextResponse.json(result, { status: 201 });
}
