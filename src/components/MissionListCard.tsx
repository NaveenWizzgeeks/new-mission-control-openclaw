'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Play,
  Eye,
  Users,
  Sparkles,
  ListTodo,
  GitBranch,
  Database,
  MoreVertical,
  Pause,
  Trash2,
  Loader2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { MissionStage } from '@/lib/types';

export interface MissionListCardData {
  id: string;
  name: string;
  mission_stage: MissionStage;
  total_subtasks: number;
  completed_subtasks: number;
  failed_subtasks: number;
  active_agent_count: number;
  awaiting_input_count: number;
  proposed_tasks_count: number;
  enable_pipeline: boolean;
  enable_existing_codebase: boolean;
  codebase_path: string | null;
  git_branch: string | null;
  planning_started: boolean;
  parent_task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    workspace_id: string;
  };
  created_at: string;
  updated_at: string;
}

interface MissionListCardProps {
  mission: MissionListCardData;
  workspaceSlug: string;
  onStageChange?: (id: string, newStage: MissionStage) => void;
  onDeleted?: (id: string) => void;
}

const STAGE_BADGE: Record<MissionStage, { label: string; classes: string; pulse?: boolean }> = {
  backlog: { label: 'Todo', classes: 'bg-mc-bg-tertiary text-mc-text-secondary border-mc-border' },
  planning: {
    label: 'Planning',
    classes: 'bg-mc-accent-blue/15 text-mc-accent-blue border-mc-accent-blue/40',
    pulse: true,
  },
  in_progress: {
    label: 'In Progress',
    classes: 'bg-mc-accent-green/15 text-mc-accent-green border-mc-accent-green/40',
    pulse: true,
  },
  testing: {
    label: 'Testing',
    classes: 'bg-mc-accent-yellow/15 text-mc-accent-yellow border-mc-accent-yellow/40',
  },
  done: {
    label: 'Done',
    classes: 'bg-mc-accent-green/10 text-mc-accent-green/80 border-mc-accent-green/20',
  },
  paused: {
    label: 'Paused',
    classes: 'bg-orange-500/15 text-orange-400 border-orange-500/40',
  },
};

interface ActionConfig {
  label: string;
  icon: React.ReactNode;
  variant: 'primary' | 'secondary';
  href?: string;
  onClick?: () => void;
}

export function MissionListCard({ mission, workspaceSlug, onStageChange, onDeleted }: MissionListCardProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detailHref = `/workspace/${workspaceSlug}/mission/${mission.id}`;
  const progress = mission.total_subtasks > 0
    ? Math.round((mission.completed_subtasks / mission.total_subtasks) * 100)
    : 0;
  const badge = STAGE_BADGE[mission.mission_stage];

  // Action button derived from stage + pipeline flags per Nexus spec
  let action: ActionConfig;
  if (mission.mission_stage === 'backlog' && mission.enable_pipeline && !mission.planning_started) {
    action = {
      label: 'Start Planning',
      icon: <Play className="w-3.5 h-3.5" />,
      variant: 'primary',
      onClick: async () => {
        setBusy(true);
        setError(null);
        try {
          // Triggers Fury question generation + advances stage atomically
          const res = await fetch(`/api/missions/${mission.id}/start-planning`, { method: 'POST' });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setError(data.error || `Start failed (${res.status})`);
          } else {
            onStageChange?.(mission.id, 'planning');
            router.push(detailHref);
          }
        } finally {
          setBusy(false);
        }
      },
    };
  } else if (mission.mission_stage === 'backlog' && !mission.enable_pipeline) {
    action = {
      label: 'Begin',
      icon: <Play className="w-3.5 h-3.5" />,
      variant: 'primary',
      onClick: async () => {
        setBusy(true);
        setError(null);
        try {
          const res = await fetch(`/api/missions/${mission.id}/stage`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stage: 'in_progress' }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setError(data.error || `Start failed (${res.status})`);
          } else {
            onStageChange?.(mission.id, 'in_progress');
            router.push(detailHref);
          }
        } finally {
          setBusy(false);
        }
      },
    };
  } else if (mission.mission_stage === 'planning') {
    action = { label: 'View Planning', icon: <Eye className="w-3.5 h-3.5" />, variant: 'secondary', href: detailHref };
  } else if (mission.mission_stage === 'in_progress') {
    action = { label: 'View Tasks', icon: <ListTodo className="w-3.5 h-3.5" />, variant: 'secondary', href: detailHref };
  } else if (mission.mission_stage === 'testing') {
    action = { label: 'View Tests', icon: <Eye className="w-3.5 h-3.5" />, variant: 'secondary', href: detailHref };
  } else {
    action = { label: 'View', icon: <Eye className="w-3.5 h-3.5" />, variant: 'secondary', href: detailHref };
  }

  const handlePause = async () => {
    setMenuOpen(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/missions/${mission.id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'paused' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Pause failed (${res.status})`);
      } else {
        onStageChange?.(mission.id, 'paused');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    if (!confirm(`Delete mission "${mission.parent_task.title}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/missions/${mission.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Delete failed (${res.status})`);
      } else {
        onDeleted?.(mission.id);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-4 hover:border-mc-accent/40 transition-colors">
      {/* Header row */}
      <div className="flex items-start gap-3 mb-2">
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider font-medium shrink-0 mt-0.5 ${badge.classes}`}
        >
          {badge.pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
          {badge.label}
        </span>

        <Link href={detailHref} className="flex-1 min-w-0 group">
          <h3 className="text-sm font-semibold text-mc-text leading-snug truncate group-hover:text-mc-accent transition-colors">
            {mission.parent_task.title}
          </h3>
        </Link>

        <div className="flex items-center gap-1 shrink-0">
          {action.href ? (
            <Link
              href={action.href}
              className={`flex items-center gap-1.5 px-3 min-h-9 rounded-lg text-xs font-medium transition-colors ${
                action.variant === 'primary'
                  ? 'bg-mc-accent text-mc-bg hover:bg-mc-accent/90'
                  : 'bg-mc-bg-tertiary text-mc-text border border-mc-border hover:border-mc-accent/40'
              }`}
            >
              {action.icon}
              {action.label}
            </Link>
          ) : (
            <button
              onClick={action.onClick}
              disabled={busy}
              className={`flex items-center gap-1.5 px-3 min-h-9 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                action.variant === 'primary'
                  ? 'bg-mc-accent text-mc-bg hover:bg-mc-accent/90'
                  : 'bg-mc-bg-tertiary text-mc-text border border-mc-border hover:border-mc-accent/40'
              }`}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : action.icon}
              {action.label}
            </button>
          )}

          <div className="relative">
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary"
              title="More"
              aria-label="More actions"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-40 w-44 rounded-lg border border-mc-border bg-mc-bg-secondary shadow-lg py-1">
                  {mission.mission_stage === 'in_progress' && (
                    <button
                      onClick={handlePause}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-mc-bg-tertiary flex items-center gap-2"
                    >
                      <Pause className="w-3.5 h-3.5" /> Pause Mission
                    </button>
                  )}
                  <button
                    onClick={handleDelete}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-mc-bg-tertiary flex items-center gap-2 text-mc-accent-red"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete Mission
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      {mission.parent_task.description && (
        <p className="text-xs text-mc-text-secondary line-clamp-2 mb-3 ml-[5.5rem]">
          {mission.parent_task.description}
        </p>
      )}

      {/* Progress bar */}
      {mission.total_subtasks > 0 ? (
        <div className="flex items-center gap-3 mb-2 ml-[5.5rem]">
          <div className="flex-1 h-1.5 rounded-full bg-mc-bg-tertiary overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                mission.failed_subtasks > 0 ? 'bg-mc-accent-red' : 'bg-mc-accent-green'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[11px] font-mono text-mc-text-secondary tabular-nums shrink-0">
            {mission.completed_subtasks}/{mission.total_subtasks} tasks
          </span>
        </div>
      ) : (
        <div className="mb-2 ml-[5.5rem] text-[11px] text-mc-text-secondary">No subtasks yet</div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 text-[11px] text-mc-text-secondary ml-[5.5rem] mb-2">
        {mission.active_agent_count > 0 && (
          <span className="flex items-center gap-1 text-mc-accent">
            <Users className="w-3 h-3" />
            {mission.active_agent_count} agent{mission.active_agent_count === 1 ? '' : 's'} working
          </span>
        )}
        {mission.total_subtasks - mission.completed_subtasks - mission.failed_subtasks > 0 && (
          <span className="flex items-center gap-1">
            <ListTodo className="w-3 h-3" />
            {mission.total_subtasks - mission.completed_subtasks - mission.failed_subtasks} pending
          </span>
        )}
        {mission.proposed_tasks_count > 0 && (
          <span className="flex items-center gap-1 text-mc-accent-purple">
            <Sparkles className="w-3 h-3" />
            {mission.proposed_tasks_count} new proposed
          </span>
        )}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 text-[10px] text-mc-text-secondary/70 ml-[5.5rem]">
        {mission.enable_existing_codebase && (
          <span className="flex items-center gap-1" title={mission.codebase_path ?? ''}>
            <Database className="w-3 h-3" />
            Existing codebase
          </span>
        )}
        {mission.git_branch && (
          <span className="flex items-center gap-1 font-mono">
            <GitBranch className="w-3 h-3" />
            {mission.git_branch}
          </span>
        )}
        <span className="ml-auto">
          {formatDistanceToNow(new Date(mission.updated_at), { addSuffix: true })}
        </span>
      </div>

      {error && (
        <div className="mt-2 ml-[5.5rem] text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded px-2 py-1">
          {error}
        </div>
      )}
    </div>
  );
}
