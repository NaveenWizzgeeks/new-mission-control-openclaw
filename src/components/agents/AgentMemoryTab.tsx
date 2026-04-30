'use client';

import { useCallback, useEffect, useState } from 'react';
import { Brain, Trash2, RefreshCw, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface MemoryRow {
  id: string;
  agent_id: string;
  session_id: string | null;
  summary: string;
  token_count: number;
  created_at: string;
}

export function AgentMemoryTab({ agentId }: { agentId: string }) {
  const [rows, setRows] = useState<MemoryRow[] | null>(null);
  const [busy, setBusy] = useState<'load' | 'clear' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/memory`);
      if (res.ok) setRows(await res.json());
      else setRows([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
      setRows([]);
    } finally {
      setBusy(null);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  const clearAll = async () => {
    if (!rows || rows.length === 0) return;
    if (!confirm(`Clear all ${rows.length} memory summary entries for this agent? This cannot be undone.`)) return;
    setBusy('clear');
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/memory`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Clear failed (${res.status})`);
      } else {
        setRows([]);
      }
    } finally {
      setBusy(null);
    }
  };

  const totalTokens = (rows ?? []).reduce((sum, r) => sum + (r.token_count || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-mc-text flex items-center gap-2">
            <Brain className="w-4 h-4 text-mc-accent-purple" /> Memory
          </h3>
          <p className="text-xs text-mc-text-secondary mt-0.5">
            Captured at session completion. The last 5 entries are prepended to
            this agent&apos;s prompt at every dispatch.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={busy !== null}
            className="text-xs px-2 py-1 rounded bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text border border-mc-border flex items-center gap-1 disabled:opacity-50"
            title="Refresh"
          >
            {busy === 'load' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </button>
          <button
            onClick={clearAll}
            disabled={busy !== null || (rows?.length ?? 0) === 0}
            className="text-xs px-2 py-1 rounded bg-mc-accent-red/10 text-mc-accent-red border border-mc-accent-red/30 flex items-center gap-1 hover:bg-mc-accent-red/20 disabled:opacity-50"
          >
            {busy === 'clear' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            Clear all
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="text-xs text-mc-text-secondary tabular-nums">
          {rows.length} summar{rows.length === 1 ? 'y' : 'ies'} · ~{totalTokens.toLocaleString()} tokens
        </div>
      )}

      {rows === null ? (
        <p className="text-sm text-mc-text-secondary py-4">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-mc-border bg-mc-bg-secondary/40 p-6 text-center text-sm text-mc-text-secondary">
          <Brain className="w-6 h-6 mx-auto mb-2 text-mc-text-secondary/60" />
          No memory yet. Summaries appear here when this agent finishes an
          OpenClaw session — the last assistant message becomes the entry.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map(r => (
            <li key={r.id} className="bg-mc-bg-secondary border border-mc-border rounded-lg p-3">
              <div className="flex items-center gap-2 text-[11px] text-mc-text-secondary mb-2">
                <span className="font-mono">
                  {formatDistanceToNow(new Date(r.created_at + (r.created_at.includes('T') ? '' : 'Z')), { addSuffix: true })}
                </span>
                {r.session_id && (
                  <>
                    <span>·</span>
                    <span className="font-mono truncate" title={r.session_id}>session {r.session_id.slice(0, 12)}…</span>
                  </>
                )}
                <span>·</span>
                <span>~{r.token_count} tok</span>
              </div>
              <pre className="text-xs text-mc-text whitespace-pre-wrap font-sans leading-snug">
                {r.summary}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
