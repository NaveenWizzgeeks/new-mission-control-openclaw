/**
 * Aggregates the live ClawHub.ai registry with the local seed catalog.
 *
 * The marketplace API always goes through this module. Routes never touch
 * `clawhub.ts` or `catalog.ts` directly.
 */

import type {
  MarketplaceListItem,
  MarketplaceSkill,
  MarketplaceKind,
  MarketplaceSource,
} from './types';
import type { SkillType } from '@/lib/agentSkills';
import { listLocal, getLocalSkill } from './catalog';
import {
  listClawHubSkills,
  listClawHubPlugins,
  getClawHubSkill,
  getClawHubPlugin,
  type ClawHubSkillRow,
  type ClawHubPluginRow,
} from './clawhub';
import { categorizeFromText, categorizePlugin } from './categorize';

export interface RegistryQuery {
  kind?: MarketplaceKind; // default 'skill'
  source?: MarketplaceSource | 'all'; // default 'all'
  q?: string;
  category?: string;
  skill_type?: SkillType;
  limit?: number; // default 60
}

export interface RegistryListResult {
  items: MarketplaceListItem[];
  sources: { clawhub: 'ok' | 'error' | 'skipped'; local: 'ok' | 'skipped' };
  categories: string[];
}

const DEFAULT_LIMIT = 60;

export async function listRegistry(opts: RegistryQuery): Promise<RegistryListResult> {
  const kind: MarketplaceKind = opts.kind ?? 'skill';
  const source: MarketplaceSource | 'all' = opts.source ?? 'all';
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const out: MarketplaceListItem[] = [];
  const seen = new Set<string>();
  const sources: RegistryListResult['sources'] = { clawhub: 'skipped', local: 'skipped' };

  // ClawHub first (so its results win on dedupe by slug).
  if (source === 'clawhub' || source === 'all') {
    try {
      if (kind === 'skill') {
        const r = await listClawHubSkills({ q: opts.q, limit });
        for (const s of r.items) {
          if (seen.has(s.slug)) continue;
          out.push(skillRowToListItem(s));
          seen.add(s.slug);
        }
      } else {
        const r = await listClawHubPlugins({ q: opts.q, limit });
        for (const p of r.items) {
          const slug = p.slug ?? p.name;
          if (seen.has(slug)) continue;
          out.push(pluginRowToListItem(p));
          seen.add(slug);
        }
      }
      sources.clawhub = 'ok';
    } catch (err) {
      console.warn('[registry] ClawHub fetch failed:', err instanceof Error ? err.message : err);
      sources.clawhub = 'error';
    }
  }

  // Local catalog (skills only — no local plugin entries currently).
  if ((source === 'local' || source === 'all') && kind === 'skill') {
    const localSkills = listLocal({ q: opts.q, category: opts.category });
    for (const s of localSkills) {
      if (seen.has(s.slug)) continue;
      out.push(skillToListItem(s));
      seen.add(s.slug);
    }
    sources.local = 'ok';
  }

  // Category + skill_type filter (post-merge so it applies to ClawHub items too).
  let filtered = out;
  if (opts.category) filtered = filtered.filter(item => item.category === opts.category);
  if (opts.skill_type) filtered = filtered.filter(item => item.skill_type === opts.skill_type);

  // Categories list reflects all results before category filter so the dropdown stays useful.
  const categories = Array.from(new Set(out.map(i => i.category))).sort();
  return { items: filtered, sources, categories };
}

export async function getRegistryItem(opts: {
  slug: string;
  kind?: MarketplaceKind;
  source?: MarketplaceSource;
}): Promise<MarketplaceSkill | null> {
  const kind = opts.kind ?? 'skill';

  // Local always wins if explicitly asked.
  if (opts.source === 'local') {
    return getLocalSkill(opts.slug);
  }

  // For 'clawhub' or unspecified, try ClawHub first; fall back to local.
  try {
    if (kind === 'skill') {
      const cs = await getClawHubSkill(opts.slug);
      if (cs) return clawhubSkillToFull(cs);
    } else {
      const cp = await getClawHubPlugin(opts.slug);
      if (cp) return clawhubPluginToFull(cp);
    }
  } catch (err) {
    console.warn('[registry] ClawHub detail fetch failed:', err instanceof Error ? err.message : err);
  }

  return getLocalSkill(opts.slug);
}

// ---------- Mappers ----------

function skillToListItem(s: MarketplaceSkill): MarketplaceListItem {
  return {
    slug: s.slug,
    name: s.name,
    short_description: s.short_description,
    author: s.author,
    category: s.category,
    tags: s.tags,
    rating: s.rating,
    rating_count: s.rating_count,
    installs: s.installs,
    skill_type: s.install_template.skill_type,
    source: s.source,
    kind: s.kind,
    verified: s.verified,
    official: s.official,
    executes_code: s.executes_code,
    family: s.family,
    version: s.version,
    external_url: s.external_url,
  };
}

function skillRowToListItem(s: ClawHubSkillRow): MarketplaceListItem {
  return {
    slug: s.slug,
    name: s.displayName || s.slug,
    short_description: trim(s.summary, 240),
    author: ownerFromSlug(s.slug),
    category: categorizeFromText(s.displayName, s.slug, s.summary),
    tags: ['clawhub', 'skill'],
    rating: starsToRating(s.stats?.stars ?? 0, s.stats?.installsAllTime ?? s.stats?.downloads ?? 0),
    rating_count: s.stats?.stars ?? 0,
    installs: s.stats?.installsAllTime ?? s.stats?.downloads ?? 0,
    skill_type: 'prompt_inject',
    source: 'clawhub',
    kind: 'skill',
    version: s.tags?.latest ?? s.latestVersion,
    external_url: `https://clawhub.ai/skills/${encodeURIComponent(s.slug)}`,
  };
}

function pluginRowToListItem(p: ClawHubPluginRow): MarketplaceListItem {
  const slug = p.slug ?? p.name;
  return {
    slug,
    name: p.displayName || p.name || slug,
    short_description: trim(p.summary, 240),
    author: p.ownerHandle ?? ownerFromSlug(slug),
    category: categorizePlugin({ summary: p.summary, family: p.family, capabilityTags: p.capabilityTags, slug }),
    tags: pluginTags(p),
    rating: 0,
    rating_count: 0,
    installs: 0,
    skill_type: 'mcp',
    source: 'clawhub',
    kind: 'plugin',
    verified: p.verificationTier === 'source-linked',
    official: p.isOfficial,
    executes_code: p.executesCode,
    family: p.family,
    version: p.latestVersion,
    external_url: `https://clawhub.ai/plugins/${encodeURIComponent(slug)}`,
  };
}

function clawhubSkillToFull(s: ClawHubSkillRow): MarketplaceSkill {
  const list = skillRowToListItem(s);
  const version = list.version ?? '0.0.0';
  return {
    slug: s.slug,
    name: list.name,
    short_description: list.short_description,
    readme: s.summary,
    author: list.author,
    version,
    category: list.category,
    tags: list.tags,
    rating: list.rating,
    rating_count: list.rating_count,
    installs: list.installs,
    updated_at: formatDate(s.updatedAt),
    source: 'clawhub',
    kind: 'skill',
    external_url: list.external_url,
    install_template: {
      skill_type: 'prompt_inject',
      skill_name: safeSkillName(s.slug),
      skill_config: {
        content: clawhubSkillPrompt(s),
      },
    },
    install_hint:
      `This installs an awareness prompt for the ClawHub skill \`${s.slug}\` (v${version}). ` +
      `For full execution behavior, install the package on the agent host: ` +
      `\`clawd skill add ${s.slug}\`.`,
  };
}

function clawhubPluginToFull(p: ClawHubPluginRow): MarketplaceSkill {
  const list = pluginRowToListItem(p);
  const version = list.version ?? '0.0.0';
  const slug = p.slug ?? p.name;
  return {
    slug,
    name: list.name,
    short_description: list.short_description,
    readme: p.summary,
    author: list.author,
    version,
    category: list.category,
    tags: list.tags,
    rating: 0,
    rating_count: 0,
    installs: 0,
    updated_at: formatDate(p.updatedAt),
    source: 'clawhub',
    kind: 'plugin',
    verified: list.verified,
    official: list.official,
    executes_code: list.executes_code,
    family: list.family,
    external_url: list.external_url,
    install_template: {
      skill_type: 'mcp',
      skill_name: safeSkillName(slug),
      skill_config: {
        url: `https://mcp.autensa.local/plugins/${slug}`,
        name: safeSkillName(slug),
      },
    },
    install_hint:
      `This installs a placeholder MCP connector. To activate the plugin on the agent runtime, run ` +
      `\`clawd plugin add ${slug}\` on the agent host. The placeholder won't function until the ` +
      `plugin is registered with the gateway and the autensa credential vault holds any required secrets.`,
  };
}

function clawhubSkillPrompt(s: ClawHubSkillRow): string {
  const v = s.tags?.latest ?? s.latestVersion ?? '0.0.0';
  const summary = s.summary?.trim() || '(no summary provided)';
  return (
    `## ClawHub Skill: ${s.displayName || s.slug} (v${v})\n\n` +
    `${summary}\n\n` +
    `*Source: clawhub.ai/skills/${s.slug}. To execute, install via \`clawd skill add ${s.slug}\` on the agent host.*`
  );
}

// ---------- helpers ----------

function trim(s: string | undefined, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

function ownerFromSlug(slug: string): string {
  // ClawHub slugs sometimes embed a scope: %40owner%2Fname or @owner/name
  const decoded = decodeURIComponent(slug);
  const m = decoded.match(/^@([^/]+)\//);
  return m ? `@${m[1]}` : 'community';
}

function starsToRating(stars: number, installs: number): number {
  if (stars === 0 && installs === 0) return 0;
  // No real rating system — synthesize a 0-5 stand-in from a star/install ratio
  // so the UI's star widget has something coherent. Capped at 5.
  if (stars === 0) return 0;
  const r = Math.min(5, 3 + Math.log10(Math.max(stars, 1)) / 2);
  return Math.round(r * 10) / 10;
}

function pluginTags(p: ClawHubPluginRow): string[] {
  const tags: string[] = ['clawhub', 'plugin'];
  if (p.family) tags.push(p.family);
  if (p.channel) tags.push(p.channel);
  if (p.executesCode) tags.push('executes-code');
  return tags;
}

function safeSkillName(slug: string): string {
  // agent_skills.skill_name is matched verbatim and used in prompts; keep it
  // safe ASCII and short.
  return decodeURIComponent(slug)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'clawhub_item';
}

function formatDate(ms?: number): string {
  if (!ms) return '';
  return new Date(ms).toISOString().slice(0, 10);
}
