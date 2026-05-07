import { NextRequest, NextResponse } from 'next/server';
import { getWebhookRow } from '@/lib/webhooks/store';
import { dispatchWebhooks } from '@/lib/webhooks/dispatcher';

export const dynamic = 'force-dynamic';

/**
 * Send a synthetic ping to a single webhook. Useful for verifying
 * the URL + signature setup before relying on it for production events.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const wh = getWebhookRow(params.id);
  if (!wh) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!wh.active) {
    return NextResponse.json(
      { error: 'Webhook is disabled (likely tripped circuit breaker). Re-enable first.', code: 'inactive' },
      { status: 409 }
    );
  }
  // Reuse the public dispatcher with a synthetic test event.
  dispatchWebhooks('webhook_test', {
    webhook_id: wh.id,
    name: wh.name,
    sent_by: 'autensa-mc/manual-test',
  });
  return NextResponse.json({ ok: true, queued: true });
}
