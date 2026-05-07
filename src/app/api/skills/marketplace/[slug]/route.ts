import { NextRequest, NextResponse } from 'next/server';
import { getRegistryItem } from '@/lib/skills-marketplace/registry';
import { scanSkill } from '@/lib/skills-marketplace/scanner';
import type { MarketplaceDetail, MarketplaceKind, MarketplaceSource } from '@/lib/skills-marketplace/types';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const { searchParams } = new URL(request.url);
  const kindRaw = (searchParams.get('kind') ?? 'skill').toLowerCase();
  const sourceRaw = searchParams.get('source')?.toLowerCase();

  const kind: MarketplaceKind = kindRaw === 'plugin' ? 'plugin' : 'skill';
  const source: MarketplaceSource | undefined =
    sourceRaw === 'local' ? 'local' : sourceRaw === 'clawhub' ? 'clawhub' : undefined;

  const skill = await getRegistryItem({ slug: params.slug, kind, source });
  if (!skill) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
  }
  const findings = scanSkill(skill.install_template.skill_type, skill.install_template.skill_config);
  const detail: MarketplaceDetail = { ...skill, security_findings: findings };
  return NextResponse.json(detail);
}
