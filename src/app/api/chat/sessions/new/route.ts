import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface Body { agentId?: string }

// POST /api/chat/sessions/new — derive a fresh user-chat sessionKey for the
// given agent. We don't need to call sessions.create on the gateway: the
// first chat.send to a sessionKey lazily creates the session there. This
// route just returns a clean unique key so the UI can swap to it.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Body;
    if (!body.agentId) return NextResponse.json({ error: 'agentId is required', code: 'validation_failed' }, { status: 400 });

    const db = getDb();
    const agent = db.prepare(`SELECT id, session_key_prefix FROM agents WHERE id = ?`).get(body.agentId) as { id: string; session_key_prefix: string | null } | undefined;
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const prefix = agent.session_key_prefix || 'agent:main:';
    const subId = uuidv4();
    const sessionKey = `${prefix}user-chat:${subId}`;

    return NextResponse.json({ ok: true, sessionKey, agentId: body.agentId, sessionId: subId });
  } catch (error) {
    console.error('[Chat new-session] failed:', error);
    return NextResponse.json({ error: 'Failed to start session', code: 'internal_error' }, { status: 500 });
  }
}
