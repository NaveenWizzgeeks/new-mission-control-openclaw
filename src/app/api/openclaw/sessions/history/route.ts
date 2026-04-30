import { NextRequest, NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';

export const dynamic = 'force-dynamic';

interface RawMessage {
  role: string;
  content: Array<{ type: string; text?: string }> | string;
  timestamp?: string | number;
}

// GET /api/openclaw/sessions/history?sessionKey=...&limit=50
//
// Proxies chat.history through the gateway and flattens the message content
// into a simple shape for the dashboard transcript view. We avoid including
// system messages — only role: 'user' and role: 'assistant'.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionKey = searchParams.get('sessionKey');
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '100', 10) || 100));

  if (!sessionKey) {
    return NextResponse.json({ error: 'sessionKey query param is required', code: 'validation_failed' }, { status: 400 });
  }

  try {
    const client = getOpenClawClient();
    if (!client.isConnected()) await client.connect();

    const result = await client.call<{ messages: RawMessage[] }>('chat.history', { sessionKey, limit });
    const raw = Array.isArray(result?.messages) ? result.messages : [];

    const messages = raw
      .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
      .map(m => ({
        role: m.role,
        text: extractText(m.content),
        timestamp: typeof m.timestamp === 'string' ? m.timestamp : (typeof m.timestamp === 'number' ? new Date(m.timestamp).toISOString() : null),
      }))
      .filter(m => m.text.length > 0);

    return NextResponse.json({ ok: true, messages, total: messages.length });
  } catch (error) {
    console.error('[Sessions history] failed:', error);
    return NextResponse.json(
      { error: 'Could not load session history from gateway', code: 'gateway_failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}

function extractText(content: RawMessage['content']): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter(c => c && c.type === 'text' && typeof c.text === 'string')
    .map(c => (c.text as string).trim())
    .filter(Boolean)
    .join('\n\n');
}
