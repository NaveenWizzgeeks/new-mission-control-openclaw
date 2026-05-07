/**
 * ClawHub.ai HTTP client.
 *
 * Live registry at https://clawhub.ai with a public Convex-backed REST API
 * mounted under /api/v1. We hit it server-side so the browser never sees the
 * upstream URL (and we get caching).
 *
 * Quirks observed:
 *   - Some skill/plugin summaries contain raw control characters that break
 *     strict JSON.parse. We sanitize before parsing.
 *   - There is no per-slug detail endpoint for plugins (the slug query param
 *     is silently ignored on the list route). For plugin detail, callers fall
 *     back to the list payload.
 *   - `nextCursor` is an opaque JSON-encoded tuple, pass it back as-is.
 */

const BASE = 'https://clawhub.ai';
const TIMEOUT_MS = 8000;
const REVALIDATE_S = 300; // 5 minutes — plenty fresh for a browse list.

const UA = 'mission-control/0.13 (+https://clawhub.ai)';

export interface ClawHubSkillRow {
  slug: string;
  displayName: string;
  summary: string;
  latestVersion?: string;
  tags?: { latest?: string };
  stats?: {
    comments?: number;
    downloads?: number;
    installsAllTime?: number;
    installsCurrent?: number;
    stars?: number;
    versions?: number;
  };
  metadata?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
}

export interface ClawHubPluginRow {
  name: string;
  /** Some endpoints (search) return `slug`; the list endpoint does not. Use `name` as the canonical slug when missing. */
  slug?: string;
  displayName: string;
  summary: string;
  family?: string; // 'code-plugin', 'bundle-plugin'
  channel?: string; // 'official', 'community'
  latestVersion?: string;
  ownerHandle?: string;
  runtimeId?: string;
  executesCode?: boolean;
  isOfficial?: boolean;
  verificationTier?: string; // 'source-linked', etc.
  capabilityTags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface ClawHubSearchHit {
  score: number;
  slug: string;
  displayName: string;
  summary: string;
  version: string | null;
  updatedAt?: number;
}

export interface ClawHubListResponse<T> {
  items: T[];
  nextCursor?: unknown;
}

async function fetchJSON<T>(path: string): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: ctl.signal,
      next: { revalidate: REVALIDATE_S, tags: ['clawhub'] },
    });
    if (!res.ok) {
      throw new Error(`ClawHub ${path} → HTTP ${res.status}`);
    }
    const raw = await res.text();
    // Strip control chars (0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F) that ClawHub
    // sometimes leaks into summary fields and which break JSON.parse.
    const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    return JSON.parse(cleaned) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function listClawHubSkills(opts?: {
  q?: string;
  limit?: number;
  cursor?: string;
}): Promise<ClawHubListResponse<ClawHubSkillRow>> {
  // Search has its own endpoint with relevance scoring. The /skills list
  // doesn't appear to honour ?q, so we route queries through search.
  if (opts?.q && opts.q.trim()) {
    const hits = await searchClawHub({ type: 'skills', q: opts.q.trim(), limit: opts.limit });
    return {
      items: hits.map(h => ({
        slug: h.slug,
        displayName: h.displayName,
        summary: h.summary,
        latestVersion: h.version ?? undefined,
        updatedAt: h.updatedAt,
      })),
    };
  }
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.cursor) params.set('cursor', opts.cursor);
  return fetchJSON<ClawHubListResponse<ClawHubSkillRow>>(`/api/v1/skills?${params.toString()}`);
}

export async function listClawHubPlugins(opts?: {
  q?: string;
  limit?: number;
  cursor?: string;
}): Promise<ClawHubListResponse<ClawHubPluginRow>> {
  if (opts?.q && opts.q.trim()) {
    const hits = await searchClawHub({ type: 'plugins', q: opts.q.trim(), limit: opts.limit });
    // Search doesn't return plugin-specific fields. We map what we have and
    // leave the rest undefined — the UI tolerates it.
    return {
      items: hits.map(h => ({
        name: h.slug,
        slug: h.slug,
        displayName: h.displayName,
        summary: h.summary,
        latestVersion: h.version ?? undefined,
        updatedAt: h.updatedAt,
      })),
    };
  }
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.cursor) params.set('cursor', opts.cursor);
  return fetchJSON<ClawHubListResponse<ClawHubPluginRow>>(`/api/v1/plugins?${params.toString()}`);
}

export async function searchClawHub(opts: {
  q: string;
  type: 'skills' | 'plugins';
  limit?: number;
}): Promise<ClawHubSearchHit[]> {
  const params = new URLSearchParams({ q: opts.q, type: opts.type });
  if (opts.limit) params.set('limit', String(opts.limit));
  const data = await fetchJSON<{ results: ClawHubSearchHit[] }>(`/api/v1/search?${params.toString()}`);
  return data.results ?? [];
}

export async function getClawHubSkill(slug: string): Promise<ClawHubSkillRow | null> {
  try {
    const data = await fetchJSON<{ skill: ClawHubSkillRow }>(`/api/v1/skills/${encodeURIComponent(slug)}`);
    return data.skill ?? null;
  } catch {
    return null;
  }
}

/**
 * Plugins have no per-slug detail endpoint on the public API. We page the
 * list until we find the slug, then fall back to /search if pagination
 * misses (which happens for items the user discovered via search and for
 * any item beyond the pagination cap).
 *
 * Search returns a thinner shape than list (no family / executesCode /
 * verificationTier / capabilityTags), but the mapper tolerates undefined.
 */
export async function getClawHubPlugin(slug: string): Promise<ClawHubPluginRow | null> {
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const r = await listClawHubPlugins({ limit: 100, cursor });
    const hit = r.items.find(p => (p.slug ?? p.name) === slug);
    if (hit) return hit;
    if (!r.nextCursor) break;
    cursor = typeof r.nextCursor === 'string' ? r.nextCursor : JSON.stringify(r.nextCursor);
  }

  // Search fallback — useful when the slug came from a search result that
  // ranks outside the list pagination window.
  try {
    const hits = await searchClawHub({ type: 'plugins', q: slug, limit: 20 });
    const hit = hits.find(h => h.slug === slug);
    if (!hit) return null;
    return {
      name: hit.slug,
      slug: hit.slug,
      displayName: hit.displayName,
      summary: hit.summary,
      latestVersion: hit.version ?? undefined,
      updatedAt: hit.updatedAt,
    };
  } catch {
    return null;
  }
}
