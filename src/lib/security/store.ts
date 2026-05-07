/**
 * Persistence + querying for security_findings.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb, queryAll, queryOne } from '@/lib/db';
import type { MessageFinding, Severity } from './scanner';

export type FindingSource = 'chat_inbound' | 'chat_outbound' | 'mcp_call' | 'skill_install';

export interface FindingRow {
  id: string;
  agent_id: string | null;
  session_id: string | null;
  source: FindingSource;
  severity: Severity;
  code: string;
  message: string;
  evidence: string | null;
  resolved: number; // 0 | 1
  resolved_at: string | null;
  created_at: string;
}

export interface FindingWithAgent extends FindingRow {
  agent_name: string | null;
  agent_role: string | null;
}

export interface RecordOpts {
  agentId?: string;
  sessionId?: string;
  source: FindingSource;
}

/** Persist a batch of scanner findings. Idempotent per (agent, session, code, evidence). */
export function recordFindings(findings: MessageFinding[], opts: RecordOpts): number {
  if (findings.length === 0) return 0;
  const db = getDb();
  // De-duplicate against the same (agent, session, code, evidence) within the
  // last hour so a noisy chat doesn't pile up identical alerts.
  const dupCheck = db.prepare(`
    SELECT id FROM security_findings
    WHERE COALESCE(agent_id, '') = COALESCE(?, '')
      AND COALESCE(session_id, '') = COALESCE(?, '')
      AND code = ?
      AND COALESCE(evidence, '') = COALESCE(?, '')
      AND created_at > datetime('now', '-1 hour')
    LIMIT 1
  `);
  const insert = db.prepare(`
    INSERT INTO security_findings (id, agent_id, session_id, source, severity, code, message, evidence, resolved, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
  `);
  let inserted = 0;
  for (const f of findings) {
    const evidence = f.evidence ?? null;
    const dup = dupCheck.get(opts.agentId ?? null, opts.sessionId ?? null, f.code, evidence);
    if (dup) continue;
    insert.run(uuidv4(), opts.agentId ?? null, opts.sessionId ?? null, opts.source, f.severity, f.code, f.message, evidence);
    inserted += 1;
  }
  return inserted;
}

export interface ListOpts {
  agentId?: string;
  severity?: Severity;
  source?: FindingSource;
  resolved?: boolean;
  limit?: number;
}

export function listFindings(opts: ListOpts = {}): FindingWithAgent[] {
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (opts.agentId) { wheres.push('f.agent_id = ?'); params.push(opts.agentId); }
  if (opts.severity) { wheres.push('f.severity = ?'); params.push(opts.severity); }
  if (opts.source) { wheres.push('f.source = ?'); params.push(opts.source); }
  if (opts.resolved !== undefined) { wheres.push('f.resolved = ?'); params.push(opts.resolved ? 1 : 0); }
  const where = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '';
  const limit = Math.min(opts.limit ?? 200, 1000);
  return queryAll<FindingWithAgent>(`
    SELECT
      f.id, f.agent_id, f.session_id, f.source, f.severity, f.code, f.message,
      f.evidence, f.resolved, f.resolved_at, f.created_at,
      a.name AS agent_name, a.role AS agent_role
    FROM security_findings f
    LEFT JOIN agents a ON a.id = f.agent_id
    ${where}
    ORDER BY f.created_at DESC
    LIMIT ${limit}
  `, params);
}

export function resolveFinding(id: string): boolean {
  const r = getDb().prepare(`
    UPDATE security_findings SET resolved = 1, resolved_at = datetime('now') WHERE id = ?
  `).run(id);
  return r.changes > 0;
}

export function findingsCountByAgent(): Array<{ agent_id: string; agent_name: string | null; agent_role: string | null; critical: number; warning: number; info: number }> {
  return queryAll(`
    SELECT
      a.id AS agent_id,
      a.name AS agent_name,
      a.role AS agent_role,
      SUM(CASE WHEN f.severity = 'critical' AND f.resolved = 0 THEN 1 ELSE 0 END) AS critical,
      SUM(CASE WHEN f.severity = 'warning'  AND f.resolved = 0 THEN 1 ELSE 0 END) AS warning,
      SUM(CASE WHEN f.severity = 'info'     AND f.resolved = 0 THEN 1 ELSE 0 END) AS info
    FROM agents a
    LEFT JOIN security_findings f ON f.agent_id = a.id
    GROUP BY a.id
    HAVING (critical + warning + info) > 0
    ORDER BY critical DESC, warning DESC, a.name ASC
  `);
}

export function getFinding(id: string): FindingWithAgent | null {
  const row = queryOne<FindingWithAgent>(`
    SELECT
      f.id, f.agent_id, f.session_id, f.source, f.severity, f.code, f.message,
      f.evidence, f.resolved, f.resolved_at, f.created_at,
      a.name AS agent_name, a.role AS agent_role
    FROM security_findings f
    LEFT JOIN agents a ON a.id = f.agent_id
    WHERE f.id = ?
  `, [id]);
  return row ?? null;
}
