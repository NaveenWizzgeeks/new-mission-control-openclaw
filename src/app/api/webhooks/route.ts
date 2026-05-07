import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { listWebhooks, createWebhook } from '@/lib/webhooks/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ items: listWebhooks() });
}

export async function POST(request: NextRequest) {
  let body: { name?: string; url?: string; events?: string[]; secret?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'validation_failed' }, { status: 400 });
  }

  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name is required', code: 'validation_failed' }, { status: 400 });
  }
  if (!body.url || !/^https?:\/\//.test(body.url)) {
    return NextResponse.json({ error: 'url must be http(s)', code: 'validation_failed' }, { status: 400 });
  }

  const secret = body.secret && body.secret.length >= 16
    ? body.secret
    : crypto.randomBytes(32).toString('hex');

  const wh = createWebhook({
    name: body.name.trim(),
    url: body.url.trim(),
    secret,
    events: Array.isArray(body.events) ? body.events : ['*'],
  });

  // Surface the secret ONCE on creation so the user can copy it.
  return NextResponse.json({ ...wh, secret }, { status: 201 });
}
