'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap, Settings, ChevronLeft, LayoutGrid, Rocket, ChevronDown, Check } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { format } from 'date-fns';
import type { Workspace } from '@/lib/types';

interface HeaderProps {
  workspace?: Workspace;
  isPortrait?: boolean;
}

export function Header({ workspace, isPortrait = true }: HeaderProps) {
  const router = useRouter();
  const { agents, tasks, isOnline } = useMissionControl();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeSubAgents, setActiveSubAgents] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadSubAgentCount = async () => {
      try {
        const res = await fetch('/api/openclaw/sessions?session_type=subagent&status=active');
        if (res.ok) {
          const sessions = await res.json();
          setActiveSubAgents(sessions.length);
        }
      } catch (error) {
        console.error('Failed to load sub-agent count:', error);
      }
    };

    loadSubAgentCount();
    const interval = setInterval(loadSubAgentCount, 30000);
    return () => clearInterval(interval);
  }, []);

  // Phase 13S.17: Header shows the *current scope* — when a workspace is
  // open, agent + task counts must be filtered to that workspace, not the
  // global store. Otherwise a workspace with 3 tasks appears as 4 because
  // tasks from sibling workspaces leak in.
  const scopedAgents = workspace ? agents.filter(a => a.workspace_id === workspace.id) : agents;
  const scopedTasks = workspace ? tasks.filter(t => t.workspace_id === workspace.id) : tasks;
  const workingAgents = scopedAgents.filter((a) => a.status === 'working').length;
  const activeAgents = workingAgents + activeSubAgents;
  // Phase 13S.6 + 13S.16 + 13S.18: rejected, proposed, and mission-parent
  // tasks are not "real" queued work. Mission parents are the missions
  // themselves in the UI, not subtasks an agent should pick up.
  const tasksInQueue = scopedTasks.filter((t) => {
    if (t.status === 'done' || t.status === 'review') return false;
    if (t.status === 'planner_proposed') return false;
    if ((t as typeof t & { rejected_at?: string | null }).rejected_at) return false;
    if ((t as typeof t & { is_mission_parent?: boolean }).is_mission_parent) return false;
    return true;
  }).length;

  const portraitWorkspaceHeader = !!workspace && isPortrait;

  // Phase 13S.11: workspace breadcrumb is a dropdown listing the other
  // workspaces so the user can hop without going back to the dashboard.
  const [wsListOpen, setWsListOpen] = useState(false);
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
  const wsMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    fetch('/api/workspaces').then(r => r.ok ? r.json() : []).then((arr: Workspace[]) => {
      if (!cancelled && Array.isArray(arr)) setAllWorkspaces(arr);
    }).catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, [workspace]);
  useEffect(() => {
    if (!wsListOpen) return;
    const onClickAway = (e: MouseEvent) => {
      if (wsMenuRef.current && !wsMenuRef.current.contains(e.target as Node)) setWsListOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [wsListOpen]);

  const renderWorkspaceBadge = (size: 'sm' | 'md') => (
    <div ref={wsMenuRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setWsListOpen(o => !o)}
        className={`flex items-center gap-2 ${size === 'sm' ? 'px-2.5 py-1.5' : 'px-2 md:px-3 py-1'} bg-mc-bg-tertiary rounded min-w-0 hover:bg-mc-bg-tertiary/70 transition-colors`}
        title="Switch workspace"
      >
        <span className={size === 'sm' ? 'text-base' : 'text-base md:text-lg'}>{workspace!.icon}</span>
        <span className={`font-medium truncate ${size === 'sm' ? 'text-sm' : 'text-sm md:text-base'}`}>{workspace!.name}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-mc-text-secondary shrink-0 transition-transform ${wsListOpen ? 'rotate-180' : ''}`} />
      </button>
      {wsListOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 max-h-80 overflow-y-auto bg-mc-bg-secondary border border-mc-border rounded-lg shadow-xl z-50 py-1">
          {allWorkspaces.length === 0 ? (
            <div className="px-3 py-2 text-xs text-mc-text-secondary">No other workspaces</div>
          ) : (
            allWorkspaces.map(ws => {
              const current = ws.id === workspace!.id;
              return (
                <Link
                  key={ws.id}
                  href={`/workspace/${ws.slug}`}
                  onClick={() => setWsListOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-mc-bg-tertiary ${current ? 'text-mc-accent' : 'text-mc-text'}`}
                >
                  <span className="text-base">{ws.icon}</span>
                  <span className="truncate flex-1">{ws.name}</span>
                  {current && <Check className="w-3.5 h-3.5 shrink-0" />}
                </Link>
              );
            })
          )}
          <div className="border-t border-mc-border mt-1 pt-1">
            <Link
              href="/"
              onClick={() => setWsListOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-xs text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-accent"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              All workspaces
            </Link>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <header
      className={`bg-mc-bg-secondary border-b border-mc-border px-3 md:px-4 ${
        portraitWorkspaceHeader ? 'py-2.5 space-y-2.5' : 'h-14 flex items-center justify-between gap-2'
      }`}
    >
      {portraitWorkspaceHeader ? (
        <>
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Link
                href="/"
                title="Back to dashboard"
                className="flex items-center gap-1.5 px-2.5 min-h-9 rounded border border-mc-border bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-accent hover:border-mc-accent/50 transition-colors shrink-0 text-xs font-medium"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <LayoutGrid className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">Dashboard</span>
              </Link>
              {renderWorkspaceBadge('sm')}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Link href="/autopilot" className="min-h-11 min-w-11 p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary flex items-center justify-center" title="Autopilot">
                <Rocket className="w-5 h-5" />
              </Link>
              <button onClick={() => router.push('/settings')} className="min-h-11 min-w-11 p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary flex items-center justify-center" title="Settings">
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`flex items-center gap-2 px-3 min-h-11 rounded border text-xs font-medium ${
                isOnline
                  ? 'bg-mc-accent-green/20 border-mc-accent-green text-mc-accent-green'
                  : 'bg-mc-accent-red/20 border-mc-accent-red text-mc-accent-red'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-mc-accent-green animate-pulse' : 'bg-mc-accent-red'}`} />
              {isOnline ? 'ONLINE' : 'OFFLINE'}
            </div>

            <div className="flex-1 grid grid-cols-2 gap-2">
              <div className="min-h-11 rounded border border-mc-border bg-mc-bg-tertiary px-2 flex items-center justify-center gap-1.5 text-xs">
                <span className="text-mc-accent-cyan font-semibold">{activeAgents}</span>
                <span className="text-mc-text-secondary">active</span>
              </div>
              <div className="min-h-11 rounded border border-mc-border bg-mc-bg-tertiary px-2 flex items-center justify-center gap-1.5 text-xs">
                <span className="text-mc-accent-purple font-semibold">{tasksInQueue}</span>
                <span className="text-mc-text-secondary">queued</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            <div className="hidden sm:flex items-center gap-2">
              <Zap className="w-5 h-5 text-mc-accent-cyan" />
              <span className="font-semibold text-mc-text uppercase tracking-wider text-sm">Mission Control</span>
            </div>

            {workspace ? (
              <div className="flex items-center gap-2 min-w-0">
                <Link
                  href="/"
                  title="Back to dashboard"
                  className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-mc-border bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-accent hover:border-mc-accent/50 transition-colors text-xs font-medium"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Dashboard</span>
                </Link>
                <span className="hidden sm:block text-mc-text-secondary">/</span>
                {renderWorkspaceBadge('md')}
              </div>
            ) : (
              <Link href="/" className="flex items-center gap-2 px-3 py-1 bg-mc-bg-tertiary rounded hover:bg-mc-bg transition-colors">
                <LayoutGrid className="w-4 h-4" />
                <span className="text-sm">All Workspaces</span>
              </Link>
            )}
          </div>

          {workspace && (
            <div className="hidden lg:flex items-center gap-8">
              <div className="text-center">
                <div className="text-2xl font-bold text-mc-accent-cyan">{activeAgents}</div>
                <div className="text-xs text-mc-text-secondary uppercase">Agents Active</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-mc-accent-purple">{tasksInQueue}</div>
                <div className="text-xs text-mc-text-secondary uppercase">Tasks in Queue</div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 md:gap-4">
            <span className="hidden md:block text-mc-text-secondary text-sm font-mono">{format(currentTime, 'HH:mm:ss')}</span>
            <div
              className={`flex items-center gap-2 px-2 md:px-3 py-1 rounded border text-xs md:text-sm font-medium ${
                isOnline
                  ? 'bg-mc-accent-green/20 border-mc-accent-green text-mc-accent-green'
                  : 'bg-mc-accent-red/20 border-mc-accent-red text-mc-accent-red'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-mc-accent-green animate-pulse' : 'bg-mc-accent-red'}`} />
              {isOnline ? 'ONLINE' : 'OFFLINE'}
            </div>
            <Link href="/autopilot" className="min-h-11 min-w-11 p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary" title="Autopilot">
              <Rocket className="w-5 h-5" />
            </Link>
            <button onClick={() => router.push('/settings')} className="min-h-11 min-w-11 p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary" title="Settings">
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </>
      )}
    </header>
  );
}
