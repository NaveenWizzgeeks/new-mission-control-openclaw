'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Header } from '@/components/Header';
import { MissionBoard } from '@/components/MissionBoard';
import { SSEDebugPanel } from '@/components/SSEDebugPanel';
import { useSSE } from '@/hooks/useSSE';
import type { Workspace } from '@/lib/types';
import type { MissionCardData } from '@/components/MissionCard';
import type { MissionStage } from '@/lib/types';

export default function WorkspacePage() {
  const params = useParams();
  const slug = params.slug as string;

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [missions, setMissions] = useState<MissionCardData[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

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

  const handleStageChange = useCallback((missionId: string, newStage: MissionStage) => {
    setMissions(prev =>
      prev.map(m => m.id === missionId ? { ...m, mission_stage: newStage } : m)
    );
  }, []);

  const handleCreateMission = useCallback(() => {
    if (!workspace) return;
    const title = window.prompt('Mission title?');
    if (!title?.trim()) return;

    fetch('/api/missions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), workspace_id: workspace.id }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.convoy) loadMissions(workspace.id);
      })
      .catch(err => console.error('[WorkspacePage] Create mission failed:', err));
  }, [workspace, loadMissions]);

  if (notFound) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
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
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🦞</div>
          <p className="text-mc-text-secondary">Loading {slug}...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-mc-bg overflow-hidden">
      <Header workspace={workspace} isPortrait={false} />

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="px-4 pt-3 pb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold text-mc-text">Missions</h2>
          <span className="text-xs text-mc-text-secondary">{missions.length} total</span>
        </div>

        <MissionBoard
          missions={missions}
          workspaceSlug={slug}
          workspaceId={workspace.id}
          onStageChange={handleStageChange}
          onCreateMission={handleCreateMission}
        />
      </div>

      <SSEDebugPanel />
    </div>
  );
}
