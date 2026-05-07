import { NextRequest, NextResponse } from 'next/server';
import { resolveFinding, getFinding } from '@/lib/security/store';

export const dynamic = 'force-dynamic';

export async function PATCH(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const ok = resolveFinding(params.id);
  if (!ok) {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404 });
  }
  const finding = getFinding(params.id);
  return NextResponse.json({ ok: true, finding });
}
