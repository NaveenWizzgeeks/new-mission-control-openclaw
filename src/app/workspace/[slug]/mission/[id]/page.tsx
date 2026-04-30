'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, FlaskConical } from 'lucide-react';
import { Header } from '@/components/Header';
import { MissionQueue } from '@/components/MissionQueue';
import { LiveFeed } from '@/components/LiveFeed';
import { AgentsSidebar } from '@/components/AgentsSidebar';
import { SSEDebugPanel } from '@/components/SSEDebugPanel';
import { MissionPipelineStepper } from '@/components/mission/MissionPipelineStepper';
import { MissionOverviewTab, type MissionDetail } from '@/components/mission/MissionOverviewTab';
import { useMissionControl } from '@/lib/store';
import { useSSE } from '@/hooks/useSSE';
import type { Workspace, MissionStage } from '@/lib/types';

export type MissionTabKey = 'overview' | 'tasks' | 'tests';
type TabKey = MissionTabKey;

export default function MissionDrilldownPage() {
  const params = useParams();
  const slug = params.slug as string;
  const missionId = params.id as string;

  const { setAgents, setTasks, setEvents, setIsOnline, setIsLoading, isLoading } = useMissionControl();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [mission, setMission] = useState<MissionDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<TabKey>('overview');

  useSSE();

  // Hydrate tab from URL hash and keep it synced.
  useEffect(() => {
    const fromHash = (): TabKey => {
      const h = window.location.hash.replace('#', '');
      return (['overview', 'tasks', 'tests'] as const).includes(h as TabKey) ? (h as TabKey) : 'overview';
    };
    setTab(fromHash());
    const onHash = () => setTab(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const setTabAndHash = (next: TabKey) => {
    setTab(next);
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${next}`);
  };

  useEffect(() => {
    async function loadWorkspace() {
      try {
        const res = await fetch(`/api/workspaces/${slug}`);
        if (res.ok) setWorkspace(await res.json());
        else if (res.status === 404) {
          setNotFound(true);
          setIsLoading(false);
        }
      } catch {
        setNotFound(true);
        setIsLoading(false);
      }
    }
    loadWorkspace();
  }, [slug, setIsLoading]);

  const loadMission = useCallback(async () => {
    try {
      const res = await fetch(`/api/missions/${missionId}`);
      if (res.ok) setMission(await res.json());
      else if (res.status === 404) setNotFound(true);
    } catch (err) {
      console.error('[MissionDrilldown] mission fetch failed:', err);
    }
  }, [missionId]);

  useEffect(() => { loadMission(); }, [loadMission]);

  useEffect(() => {
    if (!workspace) return;
    const workspaceId = workspace.id;

    async function loadData() {
      try {
        const [agentsRes, tasksRes, eventsRes] = await Promise.all([
          fetch(`/api/agents?workspace_id=${workspaceId}`),
          fetch(`/api/tasks?workspace_id=${workspaceId}`),
          fetch('/api/events'),
        ]);
        if (agentsRes.ok) setAgents(await agentsRes.json());
        if (tasksRes.ok) setTasks(await tasksRes.json());
        if (eventsRes.ok) setEvents(await eventsRes.json());
      } catch (err) {
        console.error('[MissionDrilldown] data load failed:', err);
      } finally {
        setIsLoading(false);
      }
    }

    async function checkOpenClaw() {
      try {
        const res = await fetch('/api/openclaw/status');
        if (res.ok) setIsOnline((await res.json()).connected);
      } catch {
        setIsOnline(false);
      }
    }

    loadData();
    checkOpenClaw();

    const eventPoll = setInterval(async () => {
      try {
        const res = await fetch('/api/events?limit=20');
        if (res.ok) setEvents(await res.json());
      } catch {}
    }, 30_000);
    return () => clearInterval(eventPoll);
  }, [workspace, setAgents, setTasks, setEvents, setIsOnline, setIsLoading]);

  if (notFound) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold mb-2">Not Found</h1>
          <Link href={`/workspace/${slug}`} className="inline-flex items-center gap-2 px-6 py-3 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90">
            <ChevronLeft className="w-4 h-4" />
            Back to Missions
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading || !workspace || !mission) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🦞</div>
          <p className="text-mc-text-secondary">Loading mission...</p>
        </div>
      </div>
    );
  }

  const showTests = mission.mission_stage === 'testing' || mission.mission_stage === 'done';

  const handleStageChange = (newStage: MissionStage) => {
    setMission(m => (m ? { ...m, mission_stage: newStage } : m));
  };

  return (
    <>
      <Header workspace={workspace} isPortrait={false} />

      {/* Breadcrumb */}
      <div className="border-b border-mc-border bg-mc-bg-secondary/30 px-4 pt-2 pb-2 flex-shrink-0">
        <Link
          href={`/workspace/${slug}`}
          className="inline-flex items-center gap-1 text-xs text-mc-text-secondary hover:text-mc-text transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Missions / <span className="ml-1 text-mc-text truncate max-w-md">{mission.parent_task.title}</span>
        </Link>
      </div>

      {/* Pipeline stepper (also drives tab navigation) */}
      <MissionPipelineStepper
        currentStage={mission.mission_stage}
        currentTab={tab}
        onSelectTab={setTabAndHash}
        showTests={showTests}
      />

      {/* Tab body */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === 'overview' && (
          <div className="flex-1 overflow-y-auto p-6">
            <MissionOverviewTab
              mission={mission}
              workspaceSlug={slug}
              onStageChange={handleStageChange}
              onMissionUpdated={loadMission}
            />
          </div>
        )}

        {tab === 'tasks' && (
          <div className="flex flex-1 overflow-hidden">
            <AgentsSidebar workspaceId={workspace.id} />
            <MissionQueue workspaceId={workspace.id} convoyId={missionId} />
            <LiveFeed />
          </div>
        )}

        {tab === 'tests' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto bg-mc-bg-secondary border border-mc-border rounded-xl p-6 text-center text-mc-text-secondary">
              <FlaskConical className="w-10 h-10 mx-auto mb-3 text-mc-accent-yellow" />
              <h3 className="text-base font-semibold text-mc-text mb-1">Test Results</h3>
              <p className="text-sm">Playwright integration arrives in Phase 7. This tab will surface pass/fail counts, per-test details, and a re-run button.</p>
            </div>
          </div>
        )}
      </div>

      <SSEDebugPanel />
    </>
  );
}
