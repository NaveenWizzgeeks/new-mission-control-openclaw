import { NextRequest, NextResponse } from 'next/server';
import { getWebhook, updateWebhook, deleteWebhook } from '@/lib/webhooks/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const wh = getWebhook(params.id);
  if (!wh) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(wh);
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  let body: Partial<{ name: string; url: string; events: string[]; active: boolean; secret: string }>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const updated = updateWebhook(params.id, body);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ok = deleteWebhook(params.id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
