'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Target, ArrowRight, Sparkles, Users, Plus } from 'lucide-react';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import type { Workspace } from '@/lib/types';

interface MissionRow {
  id: string;
  name: string;
  mission_stage: string;
  total_subtasks: number;
  completed_subtasks: number;
  failed_subtasks: number;
  active_agent_count: number;
  proposed_tasks_count: number;
  parent_task: { id: string; title: string; description: string | null; workspace_id: string };
  updated_at: string;
}

export function ActiveMissionCard() {
  const [active, setActive] = useState<MissionRow | null | undefined>(undefined); // undefined=loading, null=none
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/missions');
      if (!res.ok) { setActive(null); return; }
      const list: MissionRow[] = await res.json();
      const m = list.find(x => x.mission_stage === 'in_progress');
      setActive(m ?? null);
      if (m) {
        const wsRes = await fetch('/api/workspaces');
        if (wsRes.ok) {
          const arr: Workspace[] = await wsRes.json();
          setWorkspace(arr.find(w => w.id === m.parent_task.workspace_id) ?? null);
        }
      }
    } catch {
      setActive(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useDataRefresh(['workspaces', 'tasks'], load);
  // SSE re-emit listens for convoy_progress
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('mc:convoy_progress', handler);
    window.addEventListener('mc:convoy_completed', handler);
    return () => {
      window.removeEventListener('mc:convoy_progress', handler);
      window.removeEventListener('mc:convoy_completed', handler);
    };
  }, [load]);

  if (active === undefined) {
    return (
      <div className="bg-mc-bg-secondary border border-mc-border rounded-2xl p-6 h-32 animate-pulse" />
    );
  }

  if (active === null) {
    return (
      <div className="bg-mc-bg-secondary border border-dashed border-mc-border rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-mc-bg-tertiary flex items-center justify-center shrink-0">
            <Target className="w-5 h-5 text-mc-text-secondary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-mc-text">No mission in progress</h3>
            <p className="text-sm text-mc-text-secondary mt-1">
              Pick a workspace and start a mission. Only one can run at a time across the whole control plane.
            </p>
          </div>
          <Link
            href="/workspaces"
            className="inline-flex items-center gap-1.5 px-3 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> New Mission
          </Link>
        </div>
      </div>
    );
  }

  const total = active.total_subtasks;
  const pct = total > 0 ? Math.round((active.completed_subtasks / total) * 100) : 0;
  const detailHref = workspace
    ? `/workspace/${workspace.slug}/mission/${active.id}`
    : `/workspaces`;

  return (
    <div className="bg-gradient-to-br from-mc-accent/10 via-mc-bg-secondary to-mc-bg-secondary border border-mc-accent/30 rounded-2xl p-6 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-40 h-40 bg-mc-accent/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-mc-accent-green/15 text-mc-accent-green border border-mc-accent-green/40 text-[10px] uppercase tracking-wider font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-mc-accent-green animate-pulse" />
            In Progress
          </span>
          {workspace && (
            <span className="text-xs text-mc-text-secondary flex items-center gap-1">
              <span className="text-base leading-none">{workspace.icon}</span>
              {workspace.name}
            </span>
          )}
        </div>

        <h3 className="text-xl font-bold text-mc-text leading-tight mb-1 truncate">
          {active.parent_task.title}
        </h3>
        {active.parent_task.description && (
          <p className="text-sm text-mc-text-secondary line-clamp-2 mb-4">
            {active.parent_task.description}
          </p>
        )}

        {total > 0 && (
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-2 rounded-full bg-mc-bg-tertiary overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${active.failed_subtasks > 0 ? 'bg-mc-accent-red' : 'bg-mc-accent-green'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs font-mono text-mc-text-secondary tabular-nums shrink-0">
              {active.completed_subtasks}/{total} · {pct}%
            </span>
          </div>
        )}

        <div className="flex items-center gap-4 mb-4 text-[11px] text-mc-text-secondary">
          {active.active_agent_count > 0 && (
            <span className="flex items-center gap-1 text-mc-accent">
              <Users className="w-3 h-3" />
              {active.active_agent_count} agent{active.active_agent_count === 1 ? '' : 's'} working
            </span>
          )}
          {active.proposed_tasks_count > 0 && (
            <span className="flex items-center gap-1 text-mc-accent-purple">
              <Sparkles className="w-3 h-3" />
              {active.proposed_tasks_count} proposed
            </span>
          )}
        </div>

        <Link
          href={detailHref}
          className="inline-flex items-center gap-1.5 px-4 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-sm font-medium hover:bg-mc-accent/90"
        >
          Open mission <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
