'use client';

import { useCallback, useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { WorkspaceStats } from '@/lib/types';
import { useDataRefresh } from '@/hooks/useDataRefresh';

const ACTIVE_KEYS = ['planning', 'inbox', 'assigned', 'in_progress', 'convoy_active', 'testing', 'review', 'verification'] as const;

export function WorkspacesList() {
  const [workspaces, setWorkspaces] = useState<WorkspaceStats[] | null>(null);

  const load = useCallback(() => {
    fetch('/api/workspaces?stats=true')
      .then(r => r.ok ? r.json() : [])
      .then(setWorkspaces)
      .catch(() => setWorkspaces([]));
  }, []);

  useEffect(() => { load(); }, [load]);
  useDataRefresh(['workspaces'], load);

  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5 flex flex-col max-h-[28rem]">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <p className="text-sm font-medium uppercase tracking-wider text-mc-text-secondary">Workspaces</p>
        {workspaces && workspaces.length > 0 && (
          <span className="text-xs text-mc-text-secondary tabular-nums">{workspaces.length}</span>
        )}
      </div>

      {workspaces === null ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-lg bg-mc-bg-tertiary animate-pulse" />)}
        </div>
      ) : workspaces.length === 0 ? (
        <p className="text-mc-text-secondary text-sm">No workspaces yet</p>
      ) : (
        <ul className="space-y-1 overflow-y-auto -mr-2 pr-2">
          {workspaces.map(ws => {
            const active = ACTIVE_KEYS.reduce((sum, k) => sum + (ws.taskCounts[k] ?? 0), 0);
            const done = ws.taskCounts.done ?? 0;
            const total = ws.taskCounts.total;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <li key={ws.id}>
                <Link
                  href={`/workspace/${ws.slug}`}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-mc-bg-tertiary transition-colors"
                >
                  <span className="text-xl leading-none">{ws.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-sm font-medium truncate">{ws.name}</p>
                      <span className="text-xs text-mc-text-secondary tabular-nums">
                        {active > 0 ? `${active} active` : total === 0 ? 'empty' : 'idle'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-mc-bg-tertiary overflow-hidden">
                        <div
                          className="h-full bg-mc-accent-green"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-mc-text-secondary w-10 text-right">
                        {done}/{total}
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-mc-text-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
