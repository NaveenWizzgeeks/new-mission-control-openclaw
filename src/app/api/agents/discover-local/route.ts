import { NextResponse } from 'next/server';
import { discoverLocalAgents } from '@/lib/local-agents/scanner';

export const dynamic = 'force-dynamic';

/**
 * Phase 13j: scan ~/.claude/agents, ~/.codex/agents, ~/.agents/, ~/.openclaw/agents
 * for local agent definitions. Disambiguated from /api/agents/discover (which
 * lists agents from the OpenClaw gateway).
 */
export async function GET() {
  const result = discoverLocalAgents();
  return NextResponse.json(result);
}
