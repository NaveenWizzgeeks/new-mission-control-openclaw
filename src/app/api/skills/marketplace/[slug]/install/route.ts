import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/db';
import { getRegistryItem } from '@/lib/skills-marketplace/registry';
import { scanSkill, hasCritical } from '@/lib/skills-marketplace/scanner';
import { upsertTemplateAndApply, type TemplateSource } from '@/lib/skill-templates';
import type { MarketplaceKind, MarketplaceSource } from '@/lib/skills-marketplace/types';

export const dynamic = 'force-dynamic';

type InstallScope = 'agent' | 'role' | 'all';

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  let body: {
    agent_id?: string;
    force?: boolean;
    kind?: string;
    source?: string;
    scope?: string;
    role?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'validation_failed' }, { status: 400 });
  }

  const scope: InstallScope =
    body.scope === 'role' ? 'role' : body.scope === 'all' ? 'all' : 'agent';

  const kind: MarketplaceKind = body.kind === 'plugin' ? 'plugin' : 'skill';
  const source: MarketplaceSource | undefined =
    body.source === 'local' ? 'local' : body.source === 'clawhub' ? 'clawhub' : undefined;

  const skill = await getRegistryItem({ slug: params.slug, kind, source });
  if (!skill) {
    return NextResponse.json({ error: 'Skill not found', code: 'not_found' }, { status: 404 });
  }

  // Security gate applies regardless of scope.
  const findings = scanSkill(skill.install_template.skill_type, skill.install_template.skill_config);
  if (hasCritical(findings) && !body.force) {
    return NextResponse.json(
      {
        error: 'Skill has critical security findings. Pass force=true to override.',
        code: 'security_block',
        findings,
      },
      { status: 422 }
    );
  }

  const db = getDb();
  const templateSource: TemplateSource =
    skill.source === 'clawhub' ? 'marketplace_clawhub' : 'marketplace_local';

  // ---- scope: 'role' or 'all' → write template + bulk-apply ----
  if (scope === 'role' || scope === 'all') {
    if (scope === 'role' && (!body.role || typeof body.role !== 'string')) {
      return NextResponse.json(
        { error: 'role is required when scope is "role"', code: 'validation_failed' },
        { status: 400 }
      );
    }

    try {
      const result = upsertTemplateAndApply(db, {
        scope,
        role: body.role,
        skill_type: skill.install_template.skill_type,
        skill_name: skill.install_template.skill_name,
        skill_config: skill.install_template.skill_config,
        source: templateSource,
        marketplace_slug: skill.slug,
      });
      return NextResponse.json(
        {
          ok: true,
          scope,
          role: scope === 'all' ? '*' : body.role!.toLowerCase(),
          template_id: result.template_id,
          installed: {
            skill_type: skill.install_template.skill_type,
            skill_name: skill.install_template.skill_name,
            marketplace_slug: skill.slug,
            source: skill.source,
            kind: skill.kind,
          },
          propagation: {
            matched_agents: result.matched_agents,
            inserted_skills: result.inserted_skills,
            skipped_existing: result.skipped_existing,
            future_agents_inherit: true,
          },
          install_hint: skill.install_hint,
          findings,
        },
        { status: 201 }
      );
    } catch (err) {
      console.error('[Marketplace install] template apply failed:', err);
      return NextResponse.json(
        { error: 'Template install failed', code: 'internal_error' },
        { status: 500 }
      );
    }
  }

  // ---- scope: 'agent' → existing single-agent path ----
  const { agent_id } = body;
  if (!agent_id || typeof agent_id !== 'string') {
    return NextResponse.json(
      { error: 'agent_id is required when scope is "agent"', code: 'validation_failed' },
      { status: 400 }
    );
  }

  const agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(agent_id) as
    | { id: string; name: string } | undefined;
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found', code: 'agent_not_found' }, { status: 404 });
  }

  const id = uuidv4();
  const cfg = JSON.stringify(skill.install_template.skill_config);

  try {
    db.prepare(`
      INSERT INTO agent_skills (id, agent_id, skill_type, skill_name, skill_config, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
    `).run(id, agent_id, skill.install_template.skill_type, skill.install_template.skill_name, cfg);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('UNIQUE constraint failed')) {
      return NextResponse.json(
        {
          error: `${agent.name} already has a skill named "${skill.install_template.skill_name}".`,
          code: 'duplicate_skill',
        },
        { status: 409 }
      );
    }
    console.error('[Marketplace install] failed:', err);
    return NextResponse.json({ error: 'Install failed', code: 'internal_error' }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      scope: 'agent',
      installed: {
        id,
        agent_id,
        agent_name: agent.name,
        skill_type: skill.install_template.skill_type,
        skill_name: skill.install_template.skill_name,
        marketplace_slug: skill.slug,
        source: skill.source,
        kind: skill.kind,
      },
      install_hint: skill.install_hint,
      findings,
    },
    { status: 201 }
  );
}
