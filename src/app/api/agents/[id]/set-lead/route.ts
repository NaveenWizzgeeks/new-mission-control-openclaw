import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';

export const dynamic = 'force-dynamic';

// POST /api/agents/[id]/set-lead
//
// Demotes any existing lead and promotes this agent. Exactly one agent has
// is_lead=1 at any time. The Lead Agent gets a special prompt fragment
// injected at dispatch (Phase 7c orchestration); this endpoint just flips
// the flag and broadcasts so the UI reflects the new lead immediately.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const db = getDb();
    const agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(id) as { id: string; name: string } | undefined;
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const tx = db.transaction(() => {
      db.prepare(`UPDATE agents SET is_lead = 0 WHERE is_lead = 1`).run();
      db.prepare(`UPDATE agents SET is_lead = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
    });
    tx();

    // Reuse agent_health_changed as the SSE channel for lead changes — UI
     // listening to this event will refetch agents and pick up the new badge.
    broadcast({ type: 'agent_health_changed', payload: { id: agent.id, message: `${agent.name} set as Lead Agent` } });

    return NextResponse.json({ ok: true, lead_agent_id: id });
  } catch (error) {
    console.error('[Agents API] set-lead failed:', error);
    return NextResponse.json({ error: 'Failed to set lead', code: 'internal_error' }, { status: 500 });
  }
}
