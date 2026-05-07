import { NextRequest, NextResponse } from 'next/server';
import { deleteConfig } from '@/lib/github/sync';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ok = deleteConfig(params.id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
