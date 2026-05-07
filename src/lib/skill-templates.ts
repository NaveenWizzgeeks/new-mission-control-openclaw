/**
 * Role-level skill templates (Phase 13e).
 *
 * A template captures install intent at the ROLE level so the same skill
 * propagates to every agent of that role — existing agents (bulk-applied
 * at install time) and future agents (seeded by `applyTemplatesToAgent`
 * called from bootstrap-agents.ts whenever a new agent is created).
 *
 * `role='*'` is the wildcard: applies to every agent regardless of role.
 *
 * Roles are matched case-insensitively. The schema enforces uniqueness on
 * (role, skill_name); inserts are idempotent via INSERT OR IGNORE.
 */

import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/db';
import type { SkillType } from '@/lib/agentSkills';

export type TemplateScope = 'agent' | 'role' | 'all';
export type TemplateSource = 'manual' | 'marketplace_clawhub' | 'marketplace_local';

export interface SkillTemplateRow {
  id: string;
  role: string; // lowercase, or '*'
  skill_type: SkillType;
  skill_name: string;
  skill_config: string; // JSON
  source: TemplateSource;
  marketplace_slug: string | null;
  created_at: string;
}

export interface ApplyResult {
  template_id: string | null;
  matched_agents: number;
  inserted_skills: number;
  skipped_existing: number;
}

const ROLE_WILDCARD = '*';

function normRole(role: string): string {
  return (role ?? '').trim().toLowerCase();
}

/**
 * Insert (or update) a template and bulk-apply it to existing matching agents.
 * Used by the marketplace install endpoint when scope is 'role' or 'all'.
 */
export function upsertTemplateAndApply(
  db: Database.Database,
  args: {
    scope: 'role' | 'all';
    role?: string; // required when scope='role'
    skill_type: SkillType;
    skill_name: string;
    skill_config: Record<string, unknown>;
    source: TemplateSource;
    marketplace_slug?: string;
  }
): ApplyResult {
  const role = args.scope === 'all' ? ROLE_WILDCARD : normRole(args.role ?? '');
  if (!role) {
    throw new Error('role is required when scope is "role"');
  }

  const cfgStr = JSON.stringify(args.skill_config);
  const templateId = uuidv4();

  // Upsert the template row. We refresh skill_config and source on conflict
  // so re-installs from the marketplace pick up updated templates.
  db.prepare(`
    INSERT INTO agent_skill_templates (id, role, skill_type, skill_name, skill_config, source, marketplace_slug, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(role, skill_name) DO UPDATE SET
      skill_type = excluded.skill_type,
      skill_config = excluded.skill_config,
      source = excluded.source,
      marketplace_slug = excluded.marketplace_slug
  `).run(
    templateId,
    role,
    args.skill_type,
    args.skill_name,
    cfgStr,
    args.source,
    args.marketplace_slug ?? null,
  );

  // The actual stored row id may differ from `templateId` if we hit ON CONFLICT.
  const storedId = (db.prepare(
    `SELECT id FROM agent_skill_templates WHERE role = ? AND skill_name = ?`
  ).get(role, args.skill_name) as { id: string } | undefined)?.id ?? null;

  // Bulk-apply to existing agents matching this role.
  const agents = (
    role === ROLE_WILDCARD
      ? db.prepare(`SELECT id, role FROM agents`).all()
      : db.prepare(`SELECT id, role FROM agents WHERE LOWER(role) = ?`).all(role)
  ) as Array<{ id: string; role: string }>;

  let inserted = 0;
  let skipped = 0;
  const insertSkill = db.prepare(`
    INSERT OR IGNORE INTO agent_skills (id, agent_id, skill_type, skill_name, skill_config, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
  `);
  for (const a of agents) {
    const r = insertSkill.run(uuidv4(), a.id, args.skill_type, args.skill_name, cfgStr);
    if (r.changes > 0) inserted += 1;
    else skipped += 1;
  }

  return {
    template_id: storedId,
    matched_agents: agents.length,
    inserted_skills: inserted,
    skipped_existing: skipped,
  };
}

/**
 * Apply all matching templates to a single agent. Called from bootstrap-agents
 * after a new agent is inserted so it inherits the templated skill set
 * automatically (matches by role, plus the '*' wildcard).
 */
export function applyTemplatesToAgent(
  db: Database.Database,
  agent: { id: string; role: string }
): { applied: number } {
  const role = normRole(agent.role);
  const templates = db.prepare(`
    SELECT id, role, skill_type, skill_name, skill_config
    FROM agent_skill_templates
    WHERE role = ? OR role = ?
  `).all(role, ROLE_WILDCARD) as SkillTemplateRow[];

  if (templates.length === 0) return { applied: 0 };

  const insertSkill = db.prepare(`
    INSERT OR IGNORE INTO agent_skills (id, agent_id, skill_type, skill_name, skill_config, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
  `);
  let applied = 0;
  for (const t of templates) {
    const r = insertSkill.run(uuidv4(), agent.id, t.skill_type, t.skill_name, t.skill_config);
    if (r.changes > 0) applied += 1;
  }
  return { applied };
}

/** List existing roles for the install picker preview ("All Tester (3 agents)"). */
export function countAgentsByRole(role: string): number {
  const r = normRole(role);
  if (!r) return 0;
  if (r === ROLE_WILDCARD) {
    return (getDb().prepare(`SELECT COUNT(*) as n FROM agents`).get() as { n: number }).n;
  }
  return (
    getDb().prepare(`SELECT COUNT(*) as n FROM agents WHERE LOWER(role) = ?`).get(r) as { n: number }
  ).n;
}

/** Inverse of upsert — used if we ever expose a "remove template" UI. */
export function removeTemplate(role: string, skill_name: string): boolean {
  const r = role === '*' ? '*' : normRole(role);
  const result = getDb().prepare(
    `DELETE FROM agent_skill_templates WHERE role = ? AND skill_name = ?`
  ).run(r, skill_name);
  return result.changes > 0;
}
