/**
 * Import a discovered local agent into the autensa agents table.
 *
 * Idempotent on (name, source) — re-importing the same agent updates the
 * soul_md instead of inserting a duplicate.
 *
 * Imported agents are flagged is_global=1 so they're not workspace-scoped.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb, queryOne } from '@/lib/db';
import type { AgentSource, DiscoveredAgent } from './scanner';

export interface ImportResult {
  ok: boolean;
  agent_id: string;
  action: 'created' | 'updated';
  name: string;
  source: AgentSource;
}

const SOURCE_LABEL: Record<AgentSource, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  agents: 'Generic ~/.agents',
  openclaw: 'OpenClaw',
};

export function importLocalAgent(found: DiscoveredAgent): ImportResult {
  const db = getDb();
  // Match on name+source via a description tag we plant. Without a dedicated
  // column we use description for the source marker — keeps the schema flat.
  const sourceTag = `[local:${found.source}]`;
  const description = `${sourceTag} ${found.path}`;

  const existing = queryOne<{ id: string }>(
    `SELECT id FROM agents WHERE name = ? AND description LIKE ? LIMIT 1`,
    [found.name, `${sourceTag}%`],
  );

  const now = new Date().toISOString();
  if (existing) {
    db.prepare(`
      UPDATE agents SET
        description = ?,
        soul_md = ?,
        is_global = 1,
        updated_at = ?
      WHERE id = ?
    `).run(description, found.soul_excerpt, now, existing.id);
    return { ok: true, agent_id: existing.id, action: 'updated', name: found.name, source: found.source };
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO agents (id, name, role, description, avatar_emoji, status, is_master, workspace_id, soul_md, is_global, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'standby', 0, ?, ?, 1, ?, ?, ?)
  `).run(
    id,
    found.name,
    'general',
    description,
    '🤖',
    'default',
    found.soul_excerpt,
    `local:${found.source}`,
    now,
    now,
  );
  return { ok: true, agent_id: id, action: 'created', name: found.name, source: found.source };
}

export function describeSource(s: AgentSource): string {
  return SOURCE_LABEL[s] ?? s;
}
