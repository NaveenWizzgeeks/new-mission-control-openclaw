'use client';

import { FileText, MessageSquareQuote, ListTodo, FlaskConical, CheckCircle2, ChevronRight } from 'lucide-react';
import type { MissionStage } from '@/lib/types';

export type MissionTabKey = 'overview' | 'tasks' | 'team' | 'tests';

interface PipelineStep {
  key: MissionTabKey;
  label: string;
  icon: React.ReactNode;
  // The mission_stage values that "live" in this step. Used to highlight the
  // pipeline based on the current mission_stage.
  stages: MissionStage[];
  visible: boolean;
}

interface MissionPipelineStepperProps {
  currentStage: MissionStage;
  currentTab: MissionTabKey;
  onSelectTab: (tab: MissionTabKey) => void;
  showTests: boolean;
}

export function MissionPipelineStepper({ currentStage, currentTab, onSelectTab, showTests }: MissionPipelineStepperProps) {
  const allSteps: PipelineStep[] = [
    {
      key: 'overview',
      label: 'Overview',
      icon: <FileText className="w-3.5 h-3.5" />,
      stages: ['backlog'],
      visible: true,
    },
    {
      key: 'overview',
      label: 'Planning',
      icon: <MessageSquareQuote className="w-3.5 h-3.5" />,
      stages: ['planning'],
      visible: true,
    },
    {
      key: 'tasks',
      label: 'Tasks',
      icon: <ListTodo className="w-3.5 h-3.5" />,
      stages: ['in_progress', 'paused'],
      visible: true,
    },
    {
      key: 'tests',
      label: 'Testing',
      icon: <FlaskConical className="w-3.5 h-3.5" />,
      stages: ['testing'],
      visible: showTests,
    },
    {
      key: 'tests',
      label: 'Done',
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      stages: ['done'],
      visible: showTests,
    },
  ];

  const steps = allSteps.filter(s => s.visible);

  // Determine which step the mission "is on" based on current stage.
  const activeStageIdx = steps.findIndex(s => s.stages.includes(currentStage));

  return (
    <div className="py-3">
      <ol className="flex items-center gap-1 overflow-x-auto" aria-label="Mission pipeline">
        {steps.map((step, idx) => {
          // Visual state:
          // - "tabActive": user is currently looking at this tab
          // - "stageActive": mission's current stage maps here
          // - "completed": mission has progressed past this stage
          const tabActive = currentTab === step.key && (
            // disambiguate the dual-purpose 'overview' (Overview vs Planning):
            // we only highlight Planning when stage is in planning; otherwise highlight Overview.
            step.key !== 'overview' ||
            (step.label === 'Planning' ? currentStage === 'planning' : currentStage !== 'planning')
          );
          const stageActive = idx === activeStageIdx;
          const completed = activeStageIdx > -1 && idx < activeStageIdx;

          const baseClasses = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap';
          let stateClasses: string;
          if (tabActive || stageActive) {
            stateClasses = 'bg-mc-accent text-mc-bg';
          } else if (completed) {
            stateClasses = 'bg-mc-accent-green/15 text-mc-accent-green hover:bg-mc-accent-green/25';
          } else {
            stateClasses = 'bg-mc-bg-tertiary text-mc-text-secondary hover:bg-mc-bg-tertiary/70 hover:text-mc-text';
          }

          return (
            <li key={`${step.key}-${step.label}`} className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => onSelectTab(step.key)}
                aria-current={stageActive ? 'step' : undefined}
                className={`${baseClasses} ${stateClasses}`}
              >
                <span className={`shrink-0 ${stageActive && !tabActive ? 'animate-pulse' : ''}`}>
                  {completed ? <CheckCircle2 className="w-3.5 h-3.5" /> : step.icon}
                </span>
                {step.label}
              </button>
              {idx < steps.length - 1 && (
                <ChevronRight className="w-3.5 h-3.5 text-mc-text-secondary/50 shrink-0" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
