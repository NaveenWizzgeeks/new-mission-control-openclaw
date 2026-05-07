'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Loader2, Sparkles, RefreshCw, Globe, HardDrive, Cloud, AlertCircle } from 'lucide-react';
import type { MarketplaceListItem, MarketplaceKind, MarketplaceSource } from '@/lib/skills-marketplace/types';
import type { SkillType } from '@/lib/agentSkills';
import { SkillCard } from './SkillCard';
import { SkillDetailModal } from './SkillDetailModal';

interface MarketplaceResponse {
  items: MarketplaceListItem[];
  total: number;
  categories: string[];
  sources: { clawhub: 'ok' | 'error' | 'skipped'; local: 'ok' | 'skipped' };
  kind: MarketplaceKind;
}

const CATEGORY_LABELS: Record<string, string> = {
  'dev-tools': 'Dev Tools',
  testing: 'Testing',
  github: 'GitHub',
  cloud: 'Cloud',
  productivity: 'Productivity',
  communication: 'Communication',
  data: 'Data',
  persona: 'Personas',
  methodology: 'Methodology',
  security: 'Security',
  channel: 'Channel',
  memory: 'Memory',
  workflow: 'Workflow',
  other: 'Other',
};

const SOURCE_FILTERS: Array<{ value: MarketplaceSource | 'all'; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'all', label: 'All sources', icon: Cloud },
  { value: 'clawhub', label: 'ClawHub only', icon: Globe },
  { value: 'local', label: 'Local only', icon: HardDrive },
];

const TYPE_FILTERS: Array<{ value: SkillType | ''; label: string }> = [
  { value: '', label: 'All types' },
  { value: 'shell', label: 'Shell' },
  { value: 'mcp', label: 'MCP' },
  { value: 'prompt_inject', label: 'Prompt' },
  { value: 'file_access', label: 'File' },
];

export function MarketplaceGrid() {
  const [data, setData] = useState<MarketplaceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('');
  const [skillType, setSkillType] = useState<SkillType | ''>('');
  const [kind, setKind] = useState<MarketplaceKind>('skill');
  const [source, setSource] = useState<MarketplaceSource | 'all'>('all');
  const [openItem, setOpenItem] = useState<{ slug: string; kind: MarketplaceKind; source: MarketplaceSource } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ kind, source });
      if (q.trim()) params.set('q', q.trim());
      if (category) params.set('category', category);
      if (skillType) params.set('skill_type', skillType);
      const res = await fetch(`/api/skills/marketplace?${params.toString()}`);
      if (!res.ok) {
        setError(`Failed to load marketplace (${res.status})`);
        return;
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load marketplace');
    } finally {
      setLoading(false);
    }
  }, [q, category, kind, source, skillType]);

  // Initial + reactive load (debounced).
  useEffect(() => {
    const id = setTimeout(() => { load(); }, 250);
    return () => clearTimeout(id);
  }, [load]);

  const categories = useMemo(() => data?.categories ?? [], [data]);
  const clawhubFailed = data?.sources.clawhub === 'error';

  return (
    <>
      <div className="border-b border-mc-border bg-mc-bg-secondary px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-mc-accent">
            <Sparkles className="w-5 h-5" />
            <h1 className="text-lg font-semibold text-mc-text">Skills Marketplace</h1>
          </div>
          <span className="text-xs text-mc-text-secondary">
            Browse, scan, and install reusable agent capabilities — live from clawhub.ai plus a local catalog.
          </span>
          <button
            onClick={load}
            className="ml-auto flex items-center gap-1.5 px-2.5 min-h-9 rounded-lg border border-mc-border bg-mc-bg text-xs text-mc-text-secondary hover:text-mc-text"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Skills | Plugins toggle */}
        <div className="flex items-center gap-2 mt-3">
          <div className="inline-flex rounded-lg border border-mc-border bg-mc-bg overflow-hidden">
            {(['skill', 'plugin'] as MarketplaceKind[]).map(k => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`px-3 min-h-9 text-xs font-medium transition-colors ${
                  kind === k
                    ? 'bg-mc-accent text-mc-bg'
                    : 'text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary'
                }`}
              >
                {k === 'skill' ? 'Skills' : 'Plugins'}
              </button>
            ))}
          </div>

          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-mc-text-secondary" />
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={`Search ${kind === 'skill' ? 'skills' : 'plugins'} by name or summary…`}
              className="w-full min-h-9 pl-8 pr-3 rounded-lg bg-mc-bg border border-mc-border text-sm focus:outline-none focus:border-mc-accent"
            />
          </div>

          <select
            value={skillType}
            onChange={e => setSkillType(e.target.value as SkillType | '')}
            className="min-h-9 px-3 rounded-lg bg-mc-bg border border-mc-border text-sm focus:outline-none focus:border-mc-accent"
            title="Filter by what gets injected at dispatch"
          >
            {TYPE_FILTERS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          <select
            value={source}
            onChange={e => setSource(e.target.value as MarketplaceSource | 'all')}
            className="min-h-9 px-3 rounded-lg bg-mc-bg border border-mc-border text-sm focus:outline-none focus:border-mc-accent"
          >
            {SOURCE_FILTERS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="min-h-9 px-3 rounded-lg bg-mc-bg border border-mc-border text-sm focus:outline-none focus:border-mc-accent"
          >
            <option value="">All categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
            ))}
          </select>
        </div>

        {clawhubFailed && (
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-mc-accent-yellow">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>Couldn&apos;t reach clawhub.ai — showing local catalog only.</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
        {error && (
          <div className="text-sm text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        {!data && !error && (
          <div className="flex items-center justify-center gap-2 text-sm text-mc-text-secondary py-12">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading {kind === 'skill' ? 'skills' : 'plugins'}…
          </div>
        )}

        {data && data.items.length === 0 && (
          <div className="text-center text-sm text-mc-text-secondary py-12">
            No {kind === 'skill' ? 'skills' : 'plugins'} match those filters.
          </div>
        )}

        {data && data.items.length > 0 && (
          <>
            <p className="text-xs text-mc-text-secondary mb-3">
              {data.items.length} {kind === 'skill' ? 'skill' : 'plugin'}{data.items.length === 1 ? '' : 's'}
              {q ? ` matching "${q}"` : ''}
              {data.sources.clawhub === 'ok' && ' · live from clawhub.ai'}
            </p>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.items.map(s => (
                <SkillCard
                  key={`${s.source}:${s.slug}`}
                  skill={s}
                  onClick={() => setOpenItem({ slug: s.slug, kind: s.kind, source: s.source })}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {openItem && (
        <SkillDetailModal
          slug={openItem.slug}
          kind={openItem.kind}
          source={openItem.source}
          onClose={() => setOpenItem(null)}
          onInstalled={load}
        />
      )}
    </>
  );
}
