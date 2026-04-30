'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Target, ArrowRight } from 'lucide-react';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import type { Workspace } from '@/lib/types';

interface MissionRow {
  id: string;
  name: string;
  status: string;
  mission_stage: string;
  total_subtasks: number;
  completed_subtasks: number;
  failed_subtasks: number;
  awaiting_input_count: number;
  active_agent_count: number;
  created_at: string;
  updated_at: string;
  parent_task: {
    id: string;
    title: string;
    workspace_id: string;
  };
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-mc-accent-green/15 text-mc-accent-green border-mc-accent-green/30',
  paused: 'bg-mc-accent-yellow/15 text-mc-accent-yellow border-mc-accent-yellow/30',
  completing: 'bg-mc-accent-cyan/15 text-mc-accent-cyan border-mc-accent-cyan/30',
  done: 'bg-mc-accent-cyan/15 text-mc-accent-cyan border-mc-accent-cyan/30',
  failed: 'bg-mc-accent-red/15 text-mc-accent-red border-mc-accent-red/30',
};

export function RecentMissions() {
  const [missions, setMissions] = useState<MissionRow[] | null>(null);
  const [workspacesById, setWorkspacesById] = useState<Map<string, Workspace>>(new Map());

  const load = useCallback(async () => {
    try {
      const [missionsRes, workspacesRes] = await Promise.all([
        fetch('/api/missions'),
        fetch('/api/workspaces'),
      ]);
      if (missionsRes.ok) {
        const data: MissionRow[] = await missionsRes.json();
        setMissions(Array.isArray(data) ? data : []);
      }
      if (workspacesRes.ok) {
        const ws: Workspace[] = await workspacesRes.json();
        setWorkspacesById(new Map(ws.map(w => [w.id, w])));
      }
    } catch {
      setMissions(prev => prev ?? []);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useDataRefresh(['workspaces', 'tasks'], load);

  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5 flex flex-col max-h-[28rem]">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-mc-accent" />
          <p className="text-sm font-medium uppercase tracking-wider text-mc-text-secondary">Recent Missions</p>
        </div>
        {missions && missions.length > 0 && (
          <span className="text-xs text-mc-text-secondary tabular-nums">{missions.length}</span>
        )}
      </div>

      {missions === null ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-lg bg-mc-bg-tertiary animate-pulse" />)}
        </div>
      ) : missions.length === 0 ? (
        <p className="text-mc-text-secondary text-sm">No missions yet</p>
      ) : (
        <ul className="space-y-1.5 overflow-y-auto -mr-2 pr-2">
          {missions.slice(0, 5).map(m => {
            const ws = workspacesById.get(m.parent_task.workspace_id);
            const total = m.total_subtasks;
            const pct = total > 0 ? Math.round((m.completed_subtasks / total) * 100) : 0;
            const href = ws ? `/workspace/${ws.slug}/mission/${m.id}` : '#';
            return (
              <li key={m.id}>
                <Link
                  href={href}
                  className="group block px-3 py-2.5 rounded-lg hover:bg-mc-bg-tertiary transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      {ws && <span className="text-base shrink-0">{ws.icon}</span>}
                      <p className="text-sm font-medium truncate">{m.name || m.parent_task.title}</p>
                    </div>
                    <span
                      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${
                        STATUS_BADGE[m.status] ?? 'bg-mc-bg-tertiary text-mc-text-secondary border-mc-border'
                      }`}
                    >
                      {m.status}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-mc-text-secondary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>
                  {total > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-mc-bg-tertiary overflow-hidden">
                        <div className="h-full bg-mc-accent-green" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-mc-text-secondary w-10 text-right">
                        {m.completed_subtasks}/{total}
                      </span>
                    </div>
                  )}
                  {m.active_agent_count > 0 && (
                    <p className="mt-1 text-[10px] text-mc-text-secondary">
                      {m.active_agent_count} agent{m.active_agent_count === 1 ? '' : 's'} working
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
