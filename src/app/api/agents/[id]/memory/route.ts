import { NextRequest, NextResponse } from 'next/server';
import { getMemoryForAgent, clearMemoryForAgent } from '@/lib/memory/summarizer';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/agents/[id]/memory — list memory summaries (newest first, capped at 100)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const agent = getDb().prepare('SELECT id FROM agents WHERE id = ?').get(id);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  const rows = getMemoryForAgent(id, 100);
  return NextResponse.json(rows);
}

// DELETE /api/agents/[id]/memory — clear all memory for an agent
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const agent = getDb().prepare('SELECT id FROM agents WHERE id = ?').get(id);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  const result = clearMemoryForAgent(id);
  return NextResponse.json({ ok: true, deleted: result.deleted });
}
