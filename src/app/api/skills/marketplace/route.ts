import { NextRequest, NextResponse } from 'next/server';
import { listRegistry } from '@/lib/skills-marketplace/registry';
import type { MarketplaceKind, MarketplaceSource } from '@/lib/skills-marketplace/types';
import type { SkillType } from '@/lib/agentSkills';

export const dynamic = 'force-dynamic';

const ALLOWED_KIND: MarketplaceKind[] = ['skill', 'plugin'];
const ALLOWED_SOURCE: Array<MarketplaceSource | 'all'> = ['clawhub', 'local', 'all'];
const ALLOWED_SKILL_TYPE: SkillType[] = ['shell', 'mcp', 'prompt_inject', 'file_access'];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const kindRaw = (searchParams.get('kind') ?? 'skill').toLowerCase();
  const sourceRaw = (searchParams.get('source') ?? 'all').toLowerCase();
  const skillTypeRaw = searchParams.get('skill_type')?.toLowerCase();

  const kind: MarketplaceKind = ALLOWED_KIND.includes(kindRaw as MarketplaceKind)
    ? (kindRaw as MarketplaceKind)
    : 'skill';
  const source = ALLOWED_SOURCE.includes(sourceRaw as MarketplaceSource | 'all')
    ? (sourceRaw as MarketplaceSource | 'all')
    : 'all';
  const skill_type = skillTypeRaw && ALLOWED_SKILL_TYPE.includes(skillTypeRaw as SkillType)
    ? (skillTypeRaw as SkillType)
    : undefined;

  const q = searchParams.get('q') ?? undefined;
  const category = searchParams.get('category') ?? undefined;
  const limit = numParam(searchParams.get('limit'), 60, 200);

  const result = await listRegistry({ kind, source, q, category, skill_type, limit });

  return NextResponse.json({
    items: result.items,
    total: result.items.length,
    categories: result.categories,
    sources: result.sources,
    kind,
  });
}

function numParam(raw: string | null, def: number, max: number): number {
  const n = raw ? Number(raw) : def;
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}
