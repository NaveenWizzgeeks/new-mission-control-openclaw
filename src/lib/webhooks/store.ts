/**
 * Webhook persistence + circuit-breaker bookkeeping.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb, queryAll, queryOne } from '@/lib/db';

const FAILURE_DISABLE_THRESHOLD = 5;

export interface WebhookRow {
  id: string;
  name: string;
  url: string;
  secret: string;
  events_json: string;
  active: number;
  failure_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
}

export interface WebhookView {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  failure_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
}

export interface DeliveryRow {
  id: string;
  webhook_id: string;
  event_type: string;
  status_code: number | null;
  response_excerpt: string | null;
  error: string | null;
  attempt: number;
  duration_ms: number | null;
  delivered_at: string;
}

export interface DeliveryWithWebhook extends DeliveryRow {
  webhook_name: string | null;
  webhook_url: string | null;
}

function rowToView(r: WebhookRow): WebhookView {
  let events: string[];
  try { events = JSON.parse(r.events_json); } catch { events = ['*']; }
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    events,
    active: !!r.active,
    failure_count: r.failure_count,
    last_success_at: r.last_success_at,
    last_failure_at: r.last_failure_at,
    created_at: r.created_at,
  };
}

export function listWebhooks(): WebhookView[] {
  return queryAll<WebhookRow>(`
    SELECT id, name, url, secret, events_json, active, failure_count, last_success_at, last_failure_at, created_at
    FROM webhooks ORDER BY created_at DESC
  `).map(rowToView);
}

export function getWebhook(id: string): WebhookView | null {
  const r = queryOne<WebhookRow>(`
    SELECT id, name, url, secret, events_json, active, failure_count, last_success_at, last_failure_at, created_at
    FROM webhooks WHERE id = ?
  `, [id]);
  return r ? rowToView(r) : null;
}

/** Internal — returns the row including the secret (never expose to API responses). */
export function getWebhookRow(id: string): WebhookRow | null {
  return queryOne<WebhookRow>(`
    SELECT id, name, url, secret, events_json, active, failure_count, last_success_at, last_failure_at, created_at
    FROM webhooks WHERE id = ?
  `, [id]) ?? null;
}

export function listActiveWebhooksForEvent(eventType: string): WebhookRow[] {
  // SQLite has no first-class JSON contains; we filter in JS over the (small) active set.
  const rows = queryAll<WebhookRow>(`
    SELECT id, name, url, secret, events_json, active, failure_count, last_success_at, last_failure_at, created_at
    FROM webhooks WHERE active = 1
  `);
  return rows.filter(r => {
    let events: string[];
    try { events = JSON.parse(r.events_json); } catch { return false; }
    return events.includes('*') || events.includes(eventType);
  });
}

export function createWebhook(args: {
  name: string;
  url: string;
  secret: string;
  events: string[];
}): WebhookView {
  const id = uuidv4();
  const events = args.events.length > 0 ? args.events : ['*'];
  getDb().prepare(`
    INSERT INTO webhooks (id, name, url, secret, events_json, active, failure_count, created_at)
    VALUES (?, ?, ?, ?, ?, 1, 0, datetime('now'))
  `).run(id, args.name, args.url, args.secret, JSON.stringify(events));
  return getWebhook(id)!;
}

export function updateWebhook(id: string, patch: Partial<{ name: string; url: string; secret: string; events: string[]; active: boolean }>): WebhookView | null {
  const existing = getWebhookRow(id);
  if (!existing) return null;
  const next = {
    name: patch.name ?? existing.name,
    url: patch.url ?? existing.url,
    secret: patch.secret ?? existing.secret,
    events_json: patch.events ? JSON.stringify(patch.events) : existing.events_json,
    active: patch.active === undefined ? existing.active : (patch.active ? 1 : 0),
  };
  getDb().prepare(`
    UPDATE webhooks SET name = ?, url = ?, secret = ?, events_json = ?, active = ? WHERE id = ?
  `).run(next.name, next.url, next.secret, next.events_json, next.active, id);
  return getWebhook(id);
}

export function deleteWebhook(id: string): boolean {
  const r = getDb().prepare(`DELETE FROM webhooks WHERE id = ?`).run(id);
  return r.changes > 0;
}

export function recordDelivery(args: {
  webhook_id: string;
  event_type: string;
  payload: unknown;
  status_code: number | null;
  response_excerpt: string | null;
  error: string | null;
  attempt: number;
  duration_ms: number;
}): void {
  getDb().prepare(`
    INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload_json, status_code, response_excerpt, error, attempt, duration_ms, delivered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    uuidv4(), args.webhook_id, args.event_type, JSON.stringify(args.payload),
    args.status_code, args.response_excerpt, args.error, args.attempt, args.duration_ms,
  );
}

export function markSuccess(webhookId: string): void {
  getDb().prepare(`
    UPDATE webhooks SET failure_count = 0, last_success_at = datetime('now') WHERE id = ?
  `).run(webhookId);
}

export function markFailure(webhookId: string): { newCount: number; tripped: boolean } {
  getDb().prepare(`
    UPDATE webhooks SET failure_count = failure_count + 1, last_failure_at = datetime('now') WHERE id = ?
  `).run(webhookId);
  const row = getWebhookRow(webhookId);
  if (!row) return { newCount: 0, tripped: false };
  if (row.failure_count >= FAILURE_DISABLE_THRESHOLD && row.active) {
    getDb().prepare(`UPDATE webhooks SET active = 0 WHERE id = ?`).run(webhookId);
    return { newCount: row.failure_count, tripped: true };
  }
  return { newCount: row.failure_count, tripped: false };
}

export function listDeliveries(webhookId?: string, limit = 100): DeliveryWithWebhook[] {
  const where = webhookId ? 'WHERE d.webhook_id = ?' : '';
  const params = webhookId ? [webhookId] : [];
  return queryAll<DeliveryWithWebhook>(`
    SELECT
      d.id, d.webhook_id, d.event_type, d.status_code, d.response_excerpt, d.error,
      d.attempt, d.duration_ms, d.delivered_at,
      w.name AS webhook_name, w.url AS webhook_url
    FROM webhook_deliveries d
    LEFT JOIN webhooks w ON w.id = d.webhook_id
    ${where}
    ORDER BY d.delivered_at DESC
    LIMIT ${Math.min(limit, 500)}
  `, params);
}
