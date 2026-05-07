/**
 * Webhook dispatcher.
 *
 * Fan-out called from `events.ts:broadcast()` (best-effort, non-blocking).
 * For each matching active webhook:
 *   - Build payload `{ id, event, timestamp, data }`
 *   - Sign body with HMAC-SHA256(secret, body) → X-Mission-Control-Signature header
 *   - POST with 8s timeout
 *   - Retry 2x with exponential backoff on network/5xx
 *   - Record every attempt to webhook_deliveries
 *   - markSuccess / markFailure → may trip circuit breaker (auto-disable at 5 failures)
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  listActiveWebhooksForEvent,
  recordDelivery,
  markSuccess,
  markFailure,
  type WebhookRow,
} from './store';

const TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

function signBody(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function deliverOnce(wh: WebhookRow, eventId: string, eventType: string, body: string): Promise<{
  status: number | null;
  text: string | null;
  error: string | null;
  durationMs: number;
}> {
  const start = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(wh.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mission-control-event': eventType,
        'x-mission-control-event-id': eventId,
        'x-mission-control-signature': signBody(wh.secret, body),
        'user-agent': 'mission-control-webhook/0.13',
      },
      body,
      signal: ctl.signal,
    });
    const text = await res.text();
    return {
      status: res.status,
      text: text.slice(0, 500),
      error: res.ok ? null : `HTTP ${res.status}`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      status: null,
      text: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchToWebhook(wh: WebhookRow, eventId: string, eventType: string, payload: unknown): Promise<void> {
  const body = JSON.stringify({
    id: eventId,
    event: eventType,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const r = await deliverOnce(wh, eventId, eventType, body);
    recordDelivery({
      webhook_id: wh.id,
      event_type: eventType,
      payload,
      status_code: r.status,
      response_excerpt: r.text,
      error: r.error,
      attempt,
      duration_ms: r.durationMs,
    });

    const succeeded = r.status !== null && r.status >= 200 && r.status < 300;
    if (succeeded) {
      markSuccess(wh.id);
      return;
    }

    // 4xx (except 408/429) — don't retry.
    if (r.status !== null && r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
      markFailure(wh.id);
      return;
    }

    // Network error or 5xx / 408 / 429 — retry with backoff (unless last attempt).
    if (attempt < MAX_ATTEMPTS) {
      await new Promise(res => setTimeout(res, BASE_BACKOFF_MS * Math.pow(2, attempt - 1)));
    } else {
      markFailure(wh.id);
    }
  }
}

/**
 * Public fan-out. Called from broadcast(). Fire-and-forget per webhook.
 */
export function dispatchWebhooks(eventType: string, payload: unknown): void {
  let webhooks: WebhookRow[];
  try {
    webhooks = listActiveWebhooksForEvent(eventType);
  } catch (err) {
    console.error('[webhooks] dispatch lookup failed:', err);
    return;
  }
  if (webhooks.length === 0) return;
  const eventId = uuidv4();
  for (const wh of webhooks) {
    void dispatchToWebhook(wh, eventId, eventType, payload).catch(err => {
      console.error('[webhooks] dispatch error:', err);
    });
  }
}
