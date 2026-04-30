'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Database,
  GitBranch,
  Layers,
  Target,
  Calendar,
  Users,
  Sparkles,
  Play,
  Pause,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { MissionStage, Task } from '@/lib/types';

export interface MissionDetail {
  id: string;
  name: string;
  status: string;
  mission_stage: MissionStage;
  total_subtasks: number;
  completed_subtasks: number;
  failed_subtasks: number;
  enable_pipeline: boolean;
  enable_existing_codebase: boolean;
  codebase_path: string | null;
  git_branch: string | null;
  tech_stack_hint: string | null;
  success_criteria: string | null;
  codebase_summary: string | null;
  planning_started: boolean;
  proposed_tasks_count: number;
  active_agents_count: number;
  awaiting_input_count: number;
  active_agent_count: number;
  created_at: string;
  updated_at: string;
  parent_task: Task & { description?: string | null };
}

const STAGE_BADGE: Record<MissionStage, { label: string; classes: string; pulse?: boolean }> = {
  backlog: { label: 'Todo', classes: 'bg-mc-bg-tertiary text-mc-text-secondary border-mc-border' },
  planning: { label: 'Planning', classes: 'bg-mc-accent-blue/15 text-mc-accent-blue border-mc-accent-blue/40', pulse: true },
  in_progress: { label: 'In Progress', classes: 'bg-mc-accent-green/15 text-mc-accent-green border-mc-accent-green/40', pulse: true },
  testing: { label: 'Testing', classes: 'bg-mc-accent-yellow/15 text-mc-accent-yellow border-mc-accent-yellow/40' },
  done: { label: 'Done', classes: 'bg-mc-accent-green/10 text-mc-accent-green/80 border-mc-accent-green/20' },
  paused: { label: 'Paused', classes: 'bg-orange-500/15 text-orange-400 border-orange-500/40' },
};

interface MissionOverviewTabProps {
  mission: MissionDetail;
  workspaceSlug: string;
  onStageChange?: (next: MissionStage) => void;
  onMissionUpdated?: () => void;
}

export function MissionOverviewTab({ mission, onStageChange, onMissionUpdated }: MissionOverviewTabProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const badge = STAGE_BADGE[mission.mission_stage];
  const progress = mission.total_subtasks > 0
    ? Math.round((mission.completed_subtasks / mission.total_subtasks) * 100)
    : 0;

  const setStage = async (next: MissionStage) => {
    setBusy(next);
    setError(null);
    try {
      const res = await fetch(`/api/missions/${mission.id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed (${res.status})`);
        return;
      }
      onStageChange?.(next);
      onMissionUpdated?.();
      // Navigating to the kanban after starting work feels natural
      if (next === 'in_progress' || next === 'planning') router.refresh();
    } finally {
      setBusy(null);
    }
  };

  // Action buttons by stage (mirrors MissionListCard logic)
  const showStartPlanning = mission.mission_stage === 'backlog' && mission.enable_pipeline && !mission.planning_started;
  const showBegin = mission.mission_stage === 'backlog' && !mission.enable_pipeline;
  const showPause = mission.mission_stage === 'in_progress';
  const showResume = mission.mission_stage === 'paused';
  const showMarkDone = mission.mission_stage === 'in_progress' || mission.mission_stage === 'testing';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header card */}
      <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
        <div className="flex items-start gap-3 mb-3">
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider font-medium shrink-0 mt-1 ${badge.classes}`}
          >
            {badge.pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
            {badge.label}
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-mc-text leading-tight">{mission.parent_task.title}</h2>
            {mission.parent_task.description && (
              <p className="text-sm text-mc-text-secondary mt-2 whitespace-pre-wrap">
                {mission.parent_task.description}
              </p>
            )}
          </div>
        </div>

        {/* Action row */}
        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-mc-border">
          {showStartPlanning && (
            <ActionButton onClick={() => setStage('planning')} busy={busy === 'planning'} primary icon={<Play className="w-3.5 h-3.5" />}>
              Start Planning
            </ActionButton>
          )}
          {showBegin && (
            <ActionButton onClick={() => setStage('in_progress')} busy={busy === 'in_progress'} primary icon={<Play className="w-3.5 h-3.5" />}>
              Begin
            </ActionButton>
          )}
          {showPause && (
            <ActionButton onClick={() => setStage('paused')} busy={busy === 'paused'} icon={<Pause className="w-3.5 h-3.5" />}>
              Pause
            </ActionButton>
          )}
          {showResume && (
            <ActionButton onClick={() => setStage('in_progress')} busy={busy === 'in_progress'} primary icon={<Play className="w-3.5 h-3.5" />}>
              Resume
            </ActionButton>
          )}
          {showMarkDone && (
            <ActionButton onClick={() => setStage('done')} busy={busy === 'done'} icon={<CheckCircle2 className="w-3.5 h-3.5" />}>
              Mark Done
            </ActionButton>
          )}
        </div>

        {error && (
          <div className="mt-3 text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={<Target className="w-4 h-4" />} label="Subtasks" value={`${mission.completed_subtasks}/${mission.total_subtasks}`} sub={`${progress}% complete`} />
        <StatTile icon={<Users className="w-4 h-4" />} label="Active Agents" value={mission.active_agent_count.toString()} accent="text-mc-accent" />
        <StatTile icon={<Sparkles className="w-4 h-4" />} label="Proposed" value={mission.proposed_tasks_count.toString()} accent="text-mc-accent-purple" />
        <StatTile icon={<Calendar className="w-4 h-4" />} label="Updated" value={formatDistanceToNow(new Date(mission.updated_at), { addSuffix: true })} />
      </div>

      {/* Progress bar */}
      {mission.total_subtasks > 0 && (
        <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-mc-text-secondary mb-2">
            <span className="uppercase tracking-wider font-medium">Progress</span>
            <span className="font-mono tabular-nums">{progress}%</span>
          </div>
          <div className="h-2 bg-mc-bg-tertiary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${mission.failed_subtasks > 0 ? 'bg-mc-accent-red' : 'bg-mc-accent-green'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {mission.failed_subtasks > 0 && (
            <p className="text-xs text-mc-accent-red mt-2">
              {mission.failed_subtasks} failed subtask{mission.failed_subtasks === 1 ? '' : 's'}
            </p>
          )}
        </div>
      )}

      {/* Configuration */}
      <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-mc-text-secondary mb-3">Configuration</h3>
        <div className="space-y-3">
          <ConfigRow
            icon={<Sparkles className="w-4 h-4 text-mc-accent" />}
            label="Pipeline"
            value={mission.enable_pipeline ? 'Enabled — Fury runs planning before work starts' : 'Disabled — work begins immediately'}
          />
          <ConfigRow
            icon={<Database className="w-4 h-4 text-mc-accent-purple" />}
            label="Existing Codebase"
            value={mission.enable_existing_codebase ? (mission.codebase_path || 'Enabled') : 'No'}
            mono={mission.enable_existing_codebase && !!mission.codebase_path}
          />
          {mission.git_branch && (
            <ConfigRow icon={<GitBranch className="w-4 h-4 text-mc-text-secondary" />} label="Git Branch" value={mission.git_branch} mono />
          )}
          {mission.tech_stack_hint && (
            <ConfigRow icon={<Layers className="w-4 h-4 text-mc-text-secondary" />} label="Tech Stack Hint" value={mission.tech_stack_hint} />
          )}
          {mission.success_criteria && (
            <ConfigRow icon={<CheckCircle2 className="w-4 h-4 text-mc-accent-green" />} label="Success Criteria" value={mission.success_criteria} multiline />
          )}
        </div>
      </div>

      {/* Codebase summary (filled by Phase 5 Fury planning) */}
      {mission.codebase_summary && (
        <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-mc-text-secondary mb-3 flex items-center gap-2">
            <Database className="w-4 h-4" /> Codebase Summary
          </h3>
          <p className="text-sm text-mc-text whitespace-pre-wrap leading-relaxed">{mission.codebase_summary}</p>
        </div>
      )}

      {/* Clarification chat stub for planning phase (Phase 5 will fill this in) */}
      {mission.mission_stage === 'planning' && (
        <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-mc-text-secondary mb-2">
            Fury Clarification
          </h3>
          <p className="text-sm text-mc-text-secondary">
            The Fury planning pipeline (Q&amp;A → subtask generation) lands in Phase 5. This panel will host
            the clarification chat once that phase ships. For now you can move the mission to In Progress
            manually using the action buttons above, or add subtasks from the Task Board tab.
          </p>
        </div>
      )}
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-3">
      <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-mc-text-secondary mb-1 ${accent ?? ''}`}>
        {icon}
        {label}
      </div>
      <p className={`text-lg font-bold tabular-nums leading-tight ${accent ?? 'text-mc-text'}`}>{value}</p>
      {sub && <p className="text-[11px] text-mc-text-secondary mt-0.5">{sub}</p>}
    </div>
  );
}

function ConfigRow({
  icon,
  label,
  value,
  mono = false,
  multiline = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-mc-text-secondary uppercase tracking-wider">{label}</p>
        <p className={`text-sm text-mc-text ${mono ? 'font-mono' : ''} ${multiline ? 'whitespace-pre-wrap' : 'truncate'}`}>
          {value}
        </p>
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  busy,
  primary,
  icon,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  primary?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex items-center gap-1.5 px-4 min-h-9 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
        primary
          ? 'bg-mc-accent text-mc-bg hover:bg-mc-accent/90'
          : 'bg-mc-bg-tertiary text-mc-text border border-mc-border hover:border-mc-accent/40'
      }`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}
