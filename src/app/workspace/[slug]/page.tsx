'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Plus } from 'lucide-react';
import { Header } from '@/components/Header';
import { MissionListCard, type MissionListCardData } from '@/components/MissionListCard';
import { MissionModal } from '@/components/MissionModal';
import { SSEDebugPanel } from '@/components/SSEDebugPanel';
import { useSSE } from '@/hooks/useSSE';
import type { Workspace, MissionStage } from '@/lib/types';

type StageFilter = 'all' | MissionStage;

const STAGE_FILTERS: Array<{ key: StageFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'backlog', label: 'Todo' },
  { key: 'planning', label: 'Planning' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'testing', label: 'Testing' },
  { key: 'done', label: 'Done' },
  { key: 'paused', label: 'Paused' },
];

export default function WorkspacePage() {
  const params = useParams();
  const slug = params.slug as string;

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [missions, setMissions] = useState<MissionListCardData[]>([]);
  const [filter, setFilter] = useState<StageFilter>('all');
  const [notFound, setNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateMission, setShowCreateMission] = useState(false);

  useSSE();

  useEffect(() => {
    async function loadWorkspace() {
      try {
        const res = await fetch(`/api/workspaces/${slug}`);
        if (res.ok) {
          setWorkspace(await res.json());
        } else if (res.status === 404) {
          setNotFound(true);
          setIsLoading(false);
        }
      } catch {
        setNotFound(true);
        setIsLoading(false);
      }
    }
    loadWorkspace();
  }, [slug]);

  const loadMissions = useCallback(async (workspaceId: string) => {
    try {
      const res = await fetch(`/api/missions?workspace_id=${workspaceId}`);
      if (res.ok) setMissions(await res.json());
    } catch (err) {
      console.error('[WorkspacePage] Failed to load missions:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!workspace) return;
    loadMissions(workspace.id);
    const poll = setInterval(() => loadMissions(workspace.id), 30_000);
    return () => clearInterval(poll);
  }, [workspace, loadMissions]);

  // Live refresh: any convoy event from the SSE stream nudges the list to
  // re-fetch so stage transitions / deletes / new missions appear without a
  // manual reload. (The 30s poll above is the fallback.)
  useEffect(() => {
    if (!workspace) return;
    const reload = () => loadMissions(workspace.id);
    window.addEventListener('mc:convoy_progress', reload);
    window.addEventListener('mc:convoy_completed', reload);
    window.addEventListener('mc:convoy_created', reload);
    return () => {
      window.removeEventListener('mc:convoy_progress', reload);
      window.removeEventListener('mc:convoy_completed', reload);
      window.removeEventListener('mc:convoy_created', reload);
    };
  }, [workspace, loadMissions]);

  const handleStageChange = useCallback((missionId: string, newStage: MissionStage) => {
    setMissions(prev =>
      prev.map(m => m.id === missionId ? { ...m, mission_stage: newStage } : m)
    );
  }, []);

  const handleDeleted = useCallback((missionId: string) => {
    setMissions(prev => prev.filter(m => m.id !== missionId));
  }, []);

  const handleMissionCreated = useCallback(() => {
    if (!workspace) return;
    loadMissions(workspace.id);
  }, [workspace, loadMissions]);

  const filtered = useMemo(() => {
    if (filter === 'all') return missions;
    return missions.filter(m => m.mission_stage === filter);
  }, [missions, filter]);

  const counts = useMemo(() => {
    const c: Record<StageFilter, number> = {
      all: missions.length,
      backlog: 0, planning: 0, in_progress: 0, testing: 0, done: 0, paused: 0,
    };
    for (const m of missions) c[m.mission_stage] = (c[m.mission_stage] ?? 0) + 1;
    return c;
  }, [missions]);

  if (notFound) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold mb-2">Workspace Not Found</h1>
          <p className="text-mc-text-secondary mb-6">The workspace &ldquo;{slug}&rdquo; doesn&apos;t exist.</p>
          <Link href="/" className="inline-flex items-center gap-2 px-6 py-3 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90">
            <ChevronLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading || !workspace) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🦞</div>
          <p className="text-mc-text-secondary">Loading {slug}...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Header workspace={workspace} isPortrait={false} />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6 space-y-4">
          {/* Workspace summary + new mission */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-mc-text">Missions</h2>
              {workspace.path && (
                <p className="text-xs text-mc-text-secondary font-mono truncate">{workspace.path}</p>
              )}
            </div>
            <button
              onClick={() => setShowCreateMission(true)}
              className="flex items-center gap-2 px-4 min-h-10 bg-mc-accent text-mc-bg rounded-lg text-sm font-medium hover:bg-mc-accent/90 shrink-0"
            >
              <Plus className="w-4 h-4" />
              New Mission
            </button>
          </div>

          {/* Filter pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {STAGE_FILTERS.map(f => {
              const count = counts[f.key];
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    active
                      ? 'bg-mc-accent text-mc-bg'
                      : 'bg-mc-bg-secondary text-mc-text-secondary border border-mc-border hover:text-mc-text hover:border-mc-accent/40'
                  }`}
                >
                  {f.label}
                  {count > 0 && (
                    <span className={`text-[10px] tabular-nums ${active ? 'opacity-80' : 'opacity-60'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Mission list */}
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-mc-border bg-mc-bg-secondary/40 p-10 text-center">
              <div className="text-4xl mb-2">🎯</div>
              <p className="text-sm text-mc-text">
                {missions.length === 0
                  ? 'No missions yet'
                  : `No missions in ${STAGE_FILTERS.find(f => f.key === filter)?.label}`}
              </p>
              <p className="text-xs text-mc-text-secondary mt-1 mb-4">
                {missions.length === 0
                  ? 'Click "New Mission" to plan your first one.'
                  : 'Try a different filter.'}
              </p>
              {missions.length === 0 && (
                <button
                  onClick={() => setShowCreateMission(true)}
                  className="inline-flex items-center gap-2 px-4 min-h-10 bg-mc-accent text-mc-bg rounded-lg text-sm font-medium hover:bg-mc-accent/90"
                >
                  <Plus className="w-4 h-4" /> New Mission
                </button>
              )}
            </div>
          ) : (
            <ul className="space-y-3">
              {filtered.map(m => (
                <li key={m.id}>
                  <MissionListCard
                    mission={m}
                    workspaceSlug={slug}
                    onStageChange={handleStageChange}
                    onDeleted={handleDeleted}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {showCreateMission && (
        <MissionModal
          workspaceId={workspace.id}
          onClose={() => setShowCreateMission(false)}
          onCreated={handleMissionCreated}
        />
      )}

      <SSEDebugPanel />
    </>
  );
}
