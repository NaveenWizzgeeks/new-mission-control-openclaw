'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Users, MessageSquare } from 'lucide-react';
import { Header } from '@/components/Header';
import { MissionQueue } from '@/components/MissionQueue';
import { LiveFeed } from '@/components/LiveFeed';
import { AgentsSidebar } from '@/components/AgentsSidebar';
import { SSEDebugPanel } from '@/components/SSEDebugPanel';
import { MissionPipelineStepper } from '@/components/mission/MissionPipelineStepper';
import { MissionOverviewTab, type MissionDetail } from '@/components/mission/MissionOverviewTab';
import { MissionTeamTab } from '@/components/mission/MissionTeamTab';
import { MissionTestsTab } from '@/components/mission/MissionTestsTab';
import { MissionAskFuryTab } from '@/components/mission/MissionAskFuryTab';
import { useMissionControl } from '@/lib/store';
import { useSSE } from '@/hooks/useSSE';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import type { Workspace, MissionStage } from '@/lib/types';

export type MissionTabKey = 'overview' | 'tasks' | 'team' | 'tests' | 'ask-fury';
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
      return (['overview', 'tasks', 'team', 'tests', 'ask-fury'] as const).includes(h as TabKey) ? (h as TabKey) : 'overview';
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

  // Auto-poll for new follow-up proposals while the mission is in_progress.
  // The PATCH-on-task-done hook fires triggerProposal server-side; this poll
  // harvests Fury's reply and inserts planner_proposed rows. Stops polling
  // when the mission isn't in_progress anymore.
  useEffect(() => {
    if (!mission || mission.mission_stage !== 'in_progress') return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/missions/${missionId}/proposals/poll`, { method: 'POST' });
        if (res.ok) {
          const data = await res.json() as { inserted: number; total_proposed: number };
          if (data.inserted > 0) loadMission();
        }
      } catch { /* ignore — next tick will retry */ }
    };
    tick();
    const t = setInterval(tick, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [mission, missionId, loadMission]);

  // Live-update the mission card when ANY mission/task event arrives.
  // useSSE() processes the global stream; useLiveRefresh subscribes to the
  // canonical re-emitted DOM events (convoy_*, mission_stage_changed,
  // task_*). Refetch is cheap and avoids per-event payload sniffing.
  useLiveRefresh(loadMission);

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

      {/* Pipeline stepper + utility tabs (Team) */}
      <div className="border-b border-mc-border bg-mc-bg-secondary/30 flex items-center justify-between gap-3 px-4 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <MissionPipelineStepper
            currentStage={mission.mission_stage}
            currentTab={tab}
            onSelectTab={setTabAndHash}
            showTests={showTests}
            proposedCount={mission.proposed_tasks_count ?? 0}
          />
        </div>
        <button
          onClick={() => setTabAndHash('team')}
          aria-current={tab === 'team' ? 'page' : undefined}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${
            tab === 'team'
              ? 'bg-mc-accent text-mc-bg'
              : 'bg-mc-bg-tertiary text-mc-text-secondary hover:bg-mc-bg-tertiary/70 hover:text-mc-text'
          }`}
          title="Workflow + role assignments for this mission"
        >
          <Users className="w-3.5 h-3.5" />
          Team
        </button>
        <button
          onClick={() => setTabAndHash('ask-fury')}
          aria-current={tab === 'ask-fury' ? 'page' : undefined}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${
            tab === 'ask-fury'
              ? 'bg-mc-accent text-mc-bg'
              : 'bg-mc-bg-tertiary text-mc-text-secondary hover:bg-mc-bg-tertiary/70 hover:text-mc-text'
          }`}
          title="Persistent doubts thread with Fury about this mission"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Ask Fury
        </button>
      </div>

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
            <LiveFeed missionId={missionId} />
          </div>
        )}

        {tab === 'team' && (
          <div className="flex-1 overflow-y-auto p-6">
            <MissionTeamTab
              missionId={missionId}
              parentTaskId={mission.parent_task.id}
              workspaceId={workspace.id}
            />
          </div>
        )}

        {tab === 'tests' && (
          <div className="flex-1 overflow-y-auto p-6">
            <MissionTestsTab missionId={missionId} defaultCwd={mission.codebase_path} />
          </div>
        )}

        {tab === 'ask-fury' && (
          <MissionAskFuryTab
            missionId={missionId}
            missionName={mission.parent_task?.title ?? mission.name}
            missionStage={mission.mission_stage}
            codebasePath={mission.codebase_path}
            onProposalAccepted={loadMission}
          />
        )}
      </div>

      <SSEDebugPanel />
    </>
  );
}
