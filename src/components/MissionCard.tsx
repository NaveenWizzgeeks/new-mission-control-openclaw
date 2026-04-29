'use client';

import Link from 'next/link';
import { AlertCircle, Users, CheckCircle2, Circle } from 'lucide-react';
import type { MissionStage } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';

export interface MissionCardData {
  id: string;
  name: string;
  mission_stage: MissionStage;
  total_subtasks: number;
  completed_subtasks: number;
  failed_subtasks: number;
  active_agent_count: number;
  awaiting_input_count: number;
  parent_task: {
    id: string;
    title: string;
    status: string;
    priority: string;
  };
  created_at: string;
  updated_at: string;
}

interface MissionCardProps {
  mission: MissionCardData;
  workspaceSlug: string;
  isDragging?: boolean;
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-mc-accent-red',
  high: 'bg-mc-accent-yellow',
  normal: 'bg-mc-accent',
  low: 'bg-mc-text-secondary',
};

export function MissionCard({ mission, workspaceSlug, isDragging = false }: MissionCardProps) {
  const progress = mission.total_subtasks > 0
    ? Math.round((mission.completed_subtasks / mission.total_subtasks) * 100)
    : 0;

  const priorityDot = PRIORITY_DOT[mission.parent_task.priority] ?? PRIORITY_DOT.normal;

  return (
    <Link
      href={`/workspace/${workspaceSlug}/mission/${mission.id}`}
      className={`block bg-mc-bg-secondary border rounded-lg p-3 cursor-pointer hover:border-mc-accent/50 transition-colors select-none ${
        isDragging ? 'border-mc-accent shadow-lg opacity-90' : 'border-mc-border'
      }`}
      draggable={false}
    >
      {/* Header row */}
      <div className="flex items-start gap-2 mb-2">
        <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${priorityDot}`} />
        <p className="text-sm font-medium text-mc-text leading-snug line-clamp-2 flex-1">
          {mission.parent_task.title}
        </p>
      </div>

      {/* Awaiting-input badge */}
      {mission.awaiting_input_count > 0 && (
        <div className="flex items-center gap-1 mb-2 text-xs text-mc-accent-yellow font-medium">
          <AlertCircle className="w-3 h-3" />
          <span>{mission.awaiting_input_count} awaiting input</span>
        </div>
      )}

      {/* Subtask progress bar */}
      {mission.total_subtasks > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs text-mc-text-secondary mb-1">
            <span>{mission.completed_subtasks}/{mission.total_subtasks} subtasks</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1 bg-mc-bg-tertiary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                mission.failed_subtasks > 0 ? 'bg-mc-accent-red' : 'bg-mc-accent-green'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer: agent count + age */}
      <div className="flex items-center justify-between text-xs text-mc-text-secondary mt-1">
        <div className="flex items-center gap-1">
          {mission.active_agent_count > 0 ? (
            <>
              <Users className="w-3 h-3 text-mc-accent" />
              <span className="text-mc-accent">{mission.active_agent_count} active</span>
            </>
          ) : mission.completed_subtasks === mission.total_subtasks && mission.total_subtasks > 0 ? (
            <>
              <CheckCircle2 className="w-3 h-3 text-mc-accent-green" />
              <span className="text-mc-accent-green">Complete</span>
            </>
          ) : (
            <>
              <Circle className="w-3 h-3" />
              <span>No agents</span>
            </>
          )}
        </div>
        <span>{formatDistanceToNow(new Date(mission.updated_at), { addSuffix: true })}</span>
      </div>
    </Link>
  );
}
