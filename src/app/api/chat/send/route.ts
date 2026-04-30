import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';

export const dynamic = 'force-dynamic';

const MAX_MESSAGE_CHARS = 32_000;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB per attachment, base64-decoded
const MAX_ATTACHMENTS = 4;

interface Attachment {
  name: string;
  mimeType: string;
  /** base64-encoded content (no data: URL prefix). */
  data: string;
}

interface SendBody {
  sessionKey?: string;
  agentId?: string;
  message: string;
  model?: string;
  attachments?: Attachment[];
}

// POST /api/chat/send
//
// Sends a chat message into a gateway session via chat.send. If sessionKey
// is missing, derives it from agent.session_key_prefix + a default
// "user-chat" suffix the caller passes. Optional attachments (images, PDFs)
// are inlined as base64 in the message text — the gateway client doesn't
// expose typed content blocks via chat.send, so this is the pragmatic path.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as SendBody;

    if (typeof body.message !== 'string' || body.message.trim().length === 0) {
      return NextResponse.json({ error: 'message is required', code: 'validation_failed' }, { status: 400 });
    }
    if (body.message.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json({ error: `message must be <= ${MAX_MESSAGE_CHARS} chars`, code: 'too_long' }, { status: 400 });
    }
    if (body.attachments && (!Array.isArray(body.attachments) || body.attachments.length > MAX_ATTACHMENTS)) {
      return NextResponse.json({ error: `at most ${MAX_ATTACHMENTS} attachments per message`, code: 'too_many_attachments' }, { status: 400 });
    }

    const db = getDb();

    // Resolve sessionKey
    let sessionKey = body.sessionKey?.trim();
    if (!sessionKey) {
      if (!body.agentId) {
        return NextResponse.json({ error: 'either sessionKey or agentId is required', code: 'validation_failed' }, { status: 400 });
      }
      const agent = db.prepare(`SELECT id, session_key_prefix FROM agents WHERE id = ?`).get(body.agentId) as { id: string; session_key_prefix: string | null } | undefined;
      if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
      const prefix = agent.session_key_prefix || 'agent:main:';
      sessionKey = `${prefix}user-chat:${body.agentId}`;
    }

    // Build the message body. Attachments get folded into a structured
    // "<attachments>" block at the bottom so the agent sees them clearly.
    let assembled = body.message;
    if (body.attachments && body.attachments.length > 0) {
      const blocks: string[] = [];
      for (const a of body.attachments) {
        if (typeof a.data !== 'string' || typeof a.name !== 'string') continue;
        const sizeApprox = Math.floor(a.data.length * 0.75);
        if (sizeApprox > MAX_ATTACHMENT_BYTES) {
          return NextResponse.json({ error: `attachment "${a.name}" exceeds 5MB`, code: 'attachment_too_large' }, { status: 400 });
        }
        blocks.push(
          `--- attachment ${a.name} (${a.mimeType}, ~${(sizeApprox / 1024).toFixed(0)}KB) ---\n` +
          `data:${a.mimeType};base64,${a.data}`
        );
      }
      if (blocks.length > 0) {
        assembled = `${body.message}\n\n<attachments>\n${blocks.join('\n\n')}\n</attachments>`;
      }
    }

    const client = getOpenClawClient();
    if (!client.isConnected()) await client.connect();

    const params: Record<string, unknown> = {
      sessionKey,
      message: assembled,
      idempotencyKey: `user-chat-${sessionKey}-${Date.now()}`,
    };
    // Model override (gateway honours x-openclaw-model in the params if supported)
    if (body.model && body.model.trim()) params.model = body.model.trim();

    await client.call('chat.send', params);

    return NextResponse.json({ ok: true, sessionKey });
  } catch (error) {
    console.error('[Chat send] failed:', error);
    return NextResponse.json(
      { error: 'Failed to send', code: 'gateway_failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}
