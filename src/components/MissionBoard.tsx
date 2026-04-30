'use client';

import { useState, useRef } from 'react';
import { MissionCard, type MissionCardData } from './MissionCard';
import type { MissionStage } from '@/lib/types';

const STAGES: { id: MissionStage; label: string; color: string }[] = [
  { id: 'backlog',     label: 'Backlog',      color: 'border-t-mc-text-secondary' },
  { id: 'planning',   label: 'Planning',     color: 'border-t-mc-accent-purple' },
  { id: 'in_progress',label: 'In Progress',  color: 'border-t-mc-accent' },
  { id: 'testing',    label: 'Testing',      color: 'border-t-mc-accent-cyan' },
  { id: 'done',       label: 'Done',         color: 'border-t-mc-accent-green' },
];

interface MissionBoardProps {
  missions: MissionCardData[];
  workspaceSlug: string;
  workspaceId: string;
  onStageChange?: (missionId: string, newStage: MissionStage) => void;
}

export function MissionBoard({
  missions,
  workspaceSlug,
  workspaceId,
  onStageChange,
}: MissionBoardProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<MissionStage | null>(null);
  const dragStageRef = useRef<MissionStage | null>(null);

  const missionsByStage = (stage: MissionStage) =>
    missions.filter(m => (m.mission_stage ?? 'backlog') === stage);

  const handleDragStart = (e: React.DragEvent, missionId: string) => {
    setDraggedId(missionId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('missionId', missionId);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverStage(null);
    dragStageRef.current = null;
  };

  const handleDragOver = (e: React.DragEvent, stage: MissionStage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragStageRef.current !== stage) {
      dragStageRef.current = stage;
      setDragOverStage(stage);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetStage: MissionStage) => {
    e.preventDefault();
    const missionId = e.dataTransfer.getData('missionId') || draggedId;
    if (!missionId) return;

    const mission = missions.find(m => m.id === missionId);
    if (!mission || mission.mission_stage === targetStage) return;

    setDraggedId(null);
    setDragOverStage(null);
    dragStageRef.current = null;

    // Operator drag — no updated_by_agent_id field → allowed for all transitions
    try {
      const res = await fetch(`/api/missions/${missionId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: targetStage }),
      });
      if (res.ok && onStageChange) {
        onStageChange(missionId, targetStage);
      }
    } catch (err) {
      console.error('[MissionBoard] stage update failed:', err);
    }
  };

  return (
    <div className="flex-1 overflow-x-auto overflow-y-hidden">
      <div className="flex h-full gap-3 p-4 min-w-max">
        {STAGES.map(stage => {
          const cards = missionsByStage(stage.id);
          const isOver = dragOverStage === stage.id;

          return (
            <div
              key={stage.id}
              className={`flex flex-col w-[280px] rounded-lg transition-colors ${
                isOver ? 'bg-mc-bg-tertiary/80' : 'bg-mc-bg-secondary/40'
              }`}
              onDragOver={e => handleDragOver(e, stage.id)}
              onDragLeave={() => { if (dragOverStage === stage.id) setDragOverStage(null); }}
              onDrop={e => handleDrop(e, stage.id)}
            >
              {/* Column header */}
              <div className={`border-t-2 ${stage.color} rounded-t-lg px-3 pt-3 pb-2`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-mc-text">{stage.label}</span>
                  <span className="text-xs text-mc-text-secondary bg-mc-bg-tertiary rounded-full px-2 py-0.5">
                    {cards.length}
                  </span>
                </div>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2 min-h-[120px]">
                {cards.map(mission => (
                  <div
                    key={mission.id}
                    draggable
                    onDragStart={e => handleDragStart(e, mission.id)}
                    onDragEnd={handleDragEnd}
                  >
                    <MissionCard
                      mission={mission}
                      workspaceSlug={workspaceSlug}
                      isDragging={draggedId === mission.id}
                    />
                  </div>
                ))}

                {cards.length === 0 && (
                  <div className={`h-16 rounded-lg border-2 border-dashed flex items-center justify-center text-xs text-mc-text-secondary transition-colors ${
                    isOver ? 'border-mc-accent/50 bg-mc-accent/5' : 'border-mc-border/50'
                  }`}>
                    {isOver ? 'Drop here' : 'No missions'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
