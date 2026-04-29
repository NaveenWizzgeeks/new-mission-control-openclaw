'use client';

import { useCallback, useState, useEffect } from 'react';
import { Briefcase, Users, Activity, CheckCircle2 } from 'lucide-react';
import type { Agent, WorkspaceStats } from '@/lib/types';
import { useDataRefresh } from '@/hooks/useDataRefresh';

interface TaskStats {
  total: number;
  by_status: Record<string, number>;
}

const IN_FLIGHT_STATUSES = ['planning', 'inbox', 'assigned', 'in_progress', 'convoy_active', 'testing', 'review', 'verification'];

interface TileProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint?: string;
  loading?: boolean;
  accent?: string;
}

function Tile({ icon, label, value, hint, loading, accent = 'text-mc-accent' }: TileProps) {
  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-4 flex flex-col gap-2">
      <div className={`flex items-center gap-2 text-xs uppercase tracking-wider text-mc-text-secondary`}>
        <span className={accent}>{icon}</span>
        {label}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-3xl font-bold tabular-nums">
          {loading ? <span className="text-mc-text-secondary">—</span> : value}
        </span>
        {hint && <span className="text-xs text-mc-text-secondary truncate">{hint}</span>}
      </div>
    </div>
  );
}

export function HeroStats() {
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceStats[] | null>(null);

  const load = useCallback(() => {
    fetch('/api/stats/tasks').then(r => r.ok ? r.json() : null).then(setTaskStats).catch(() => setTaskStats(null));
    fetch('/api/agents').then(r => r.ok ? r.json() : []).then(setAgents).catch(() => setAgents([]));
    fetch('/api/workspaces?stats=true').then(r => r.ok ? r.json() : []).then(setWorkspaces).catch(() => setWorkspaces([]));
  }, []);

  useEffect(() => { load(); }, [load]);
  useDataRefresh(['workspaces', 'agents', 'tasks'], load);

  const inFlight = taskStats
    ? IN_FLIGHT_STATUSES.reduce((sum, s) => sum + (taskStats.by_status[s] ?? 0), 0)
    : 0;
  const done = taskStats?.by_status.done ?? 0;
  const working = agents?.filter(a => a.status === 'working').length ?? 0;
  const totalAgents = agents?.length ?? 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Tile
        icon={<Briefcase className="w-4 h-4" />}
        label="Workspaces"
        value={workspaces?.length ?? 0}
        loading={workspaces === null}
        accent="text-mc-accent-purple"
      />
      <Tile
        icon={<Users className="w-4 h-4" />}
        label="Agents"
        value={totalAgents}
        hint={totalAgents > 0 ? `${working} working` : undefined}
        loading={agents === null}
        accent="text-mc-accent-green"
      />
      <Tile
        icon={<Activity className="w-4 h-4" />}
        label="In flight"
        value={inFlight}
        loading={taskStats === null}
        accent="text-mc-accent"
      />
      <Tile
        icon={<CheckCircle2 className="w-4 h-4" />}
        label="Done"
        value={done}
        loading={taskStats === null}
        accent="text-mc-accent-green"
      />
    </div>
  );
}
