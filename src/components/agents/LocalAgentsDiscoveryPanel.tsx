'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  HardDrive, RefreshCw, Loader2, Download, CheckCircle2, AlertCircle, ChevronLeft, FolderSearch,
} from 'lucide-react';

type AgentSource = 'claude' | 'codex' | 'agents' | 'openclaw';

interface DiscoveredAgent {
  source: AgentSource;
  path: string;
  name: string;
  soul_excerpt: string;
  size_bytes: number;
  modified_at: string;
}

interface DiscoverResponse {
  agents: DiscoveredAgent[];
  roots_scanned: string[];
  roots_missing: string[];
}

const SOURCE_LABEL: Record<AgentSource, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  agents: '~/.agents',
  openclaw: 'OpenClaw',
};

const SOURCE_BADGE: Record<AgentSource, string> = {
  claude: 'bg-mc-accent-purple/15 text-mc-accent-purple border-mc-accent-purple/40',
  codex: 'bg-mc-accent-blue/15 text-mc-accent-blue border-mc-accent-blue/40',
  agents: 'bg-mc-accent-green/15 text-mc-accent-green border-mc-accent-green/40',
  openclaw: 'bg-mc-accent-cyan/15 text-mc-accent-cyan border-mc-accent-cyan/40',
};

export function LocalAgentsDiscoveryPanel() {
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [importResults, setImportResults] = useState<Record<string, { ok: boolean; action: string; msg: string }>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/agents/discover-local');
      if (!res.ok) { setError(`Discovery failed (${res.status})`); return; }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discovery failed');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const importOne = async (a: DiscoveredAgent) => {
    const key = `${a.source}:${a.path}`;
    setBusyKey(key);
    try {
      const res = await fetch('/api/agents/import-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: a.source, path: a.path }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportResults(p => ({ ...p, [key]: { ok: false, action: 'error', msg: data.error || `HTTP ${res.status}` } }));
      } else {
        setImportResults(p => ({ ...p, [key]: { ok: true, action: data.action, msg: `${data.action} as ${data.name}` } }));
      }
    } catch (err) {
      setImportResults(p => ({ ...p, [key]: { ok: false, action: 'error', msg: err instanceof Error ? err.message : 'Import failed' } }));
    } finally { setBusyKey(null); }
  };

  const importAll = async () => {
    if (!data) return;
    for (const a of data.agents) {
      await importOne(a);
    }
  };

  return (
    <>
      <div className="border-b border-mc-border bg-mc-bg-secondary px-5 py-4">
        <div className="flex items-center gap-3">
          <Link href="/agents" className="p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary" title="Back to agents">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2 text-mc-accent-green">
            <FolderSearch className="w-5 h-5" />
            <h1 className="text-lg font-semibold text-mc-text">Discover Local Agents</h1>
          </div>
          <span className="text-xs text-mc-text-secondary">
            Scans <code>~/.claude/agents</code> · <code>~/.codex/agents</code> · <code>~/.agents</code> · <code>~/.openclaw/agents</code>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={importAll}
              disabled={!data || data.agents.length === 0 || !!busyKey}
              className="flex items-center gap-1.5 px-2.5 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" /> Import all
            </button>
            <button
              onClick={load}
              className="flex items-center gap-1.5 px-2.5 min-h-9 rounded-lg border border-mc-border bg-mc-bg text-xs text-mc-text-secondary hover:text-mc-text"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Rescan
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-5">
        {error && (
          <div className="text-sm text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">{error}</div>
        )}

        {!data && !error && (
          <div className="flex items-center gap-2 text-sm text-mc-text-secondary py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Scanning…
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="rounded-lg border border-mc-border bg-mc-bg-secondary px-3 py-2">
                <div className="text-mc-text-secondary">Roots scanned</div>
                <div className="font-mono">{data.roots_scanned.length}</div>
              </div>
              <div className="rounded-lg border border-mc-border bg-mc-bg-secondary px-3 py-2">
                <div className="text-mc-text-secondary">Roots missing</div>
                <div className="font-mono">{data.roots_missing.length}</div>
              </div>
              <div className="rounded-lg border border-mc-border bg-mc-bg-secondary px-3 py-2">
                <div className="text-mc-text-secondary">Agents found</div>
                <div className="font-mono">{data.agents.length}</div>
              </div>
              <div className="rounded-lg border border-mc-border bg-mc-bg-secondary px-3 py-2">
                <div className="text-mc-text-secondary">Sources</div>
                <div className="font-mono">{Array.from(new Set(data.agents.map(a => a.source))).join(', ') || '—'}</div>
              </div>
            </div>

            {data.roots_missing.length > 0 && (
              <details className="text-xs text-mc-text-secondary">
                <summary className="cursor-pointer hover:text-mc-text">Missing roots ({data.roots_missing.length})</summary>
                <ul className="mt-2 space-y-1 font-mono">
                  {data.roots_missing.map(r => (<li key={r} className="text-mc-text-secondary">• {r}</li>))}
                </ul>
              </details>
            )}

            <section>
              <h2 className="text-xs uppercase tracking-wider text-mc-text-secondary mb-2">Discovered agents</h2>
              {data.agents.length === 0 ? (
                <div className="text-center text-sm text-mc-text-secondary py-12 border border-dashed border-mc-border rounded-lg">
                  Nothing found in any of the known roots.
                  <br />
                  <span className="text-[11px]">
                    Add an agent file to <code>~/.claude/agents/&lt;name&gt;.md</code> or <code>~/.agents/&lt;name&gt;/SOUL.md</code>, then rescan.
                  </span>
                </div>
              ) : (
                <ul className="space-y-2">
                  {data.agents.map(a => {
                    const key = `${a.source}:${a.path}`;
                    const result = importResults[key];
                    return (
                      <li key={key} className="rounded-lg border border-mc-border bg-mc-bg-secondary p-3">
                        <div className="flex items-start gap-3">
                          <HardDrive className="w-4 h-4 mt-0.5 text-mc-text-secondary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-sm font-semibold text-mc-text">{a.name}</h3>
                              <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${SOURCE_BADGE[a.source]}`}>
                                {SOURCE_LABEL[a.source]}
                              </span>
                              <span className="text-[10px] text-mc-text-secondary">{a.size_bytes} bytes · modified {new Date(a.modified_at).toLocaleString()}</span>
                            </div>
                            <p className="text-[11px] font-mono text-mc-text-secondary mt-0.5 truncate">{a.path}</p>
                            {a.soul_excerpt && (
                              <pre className="text-[11px] text-mc-text-secondary mt-2 px-2 py-1 rounded bg-mc-bg-tertiary border border-mc-border whitespace-pre-wrap line-clamp-4">
                                {a.soul_excerpt.slice(0, 320)}{a.soul_excerpt.length > 320 ? '…' : ''}
                              </pre>
                            )}
                            {result && (
                              <p className={`mt-2 inline-flex items-center gap-1 text-[11px] ${result.ok ? 'text-mc-accent-green' : 'text-mc-accent-red'}`}>
                                {result.ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                                {result.msg}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => importOne(a)}
                            disabled={busyKey === key}
                            className="flex items-center gap-1.5 px-3 min-h-9 rounded-lg bg-mc-accent/10 border border-mc-accent/40 text-xs text-mc-accent hover:bg-mc-accent/20 disabled:opacity-50"
                          >
                            {busyKey === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                            Import
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
