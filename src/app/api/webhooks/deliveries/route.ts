import { NextRequest, NextResponse } from 'next/server';
import { listDeliveries } from '@/lib/webhooks/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const webhookId = searchParams.get('webhook_id') ?? undefined;
  const limit = Number(searchParams.get('limit') ?? 100);
  return NextResponse.json({
    items: listDeliveries(webhookId, Number.isFinite(limit) && limit > 0 ? limit : 100),
  });
}
