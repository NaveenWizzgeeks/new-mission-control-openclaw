'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ListTodo, Loader2, RefreshCw } from 'lucide-react';
import { Header } from '@/components/Header';
import { MissionQueue } from '@/components/MissionQueue';
import { AgentsSidebar } from '@/components/AgentsSidebar';
import { LiveFeed } from '@/components/LiveFeed';
import { useSSE } from '@/hooks/useSSE';
import type { Workspace } from '@/lib/types';

/**
 * Phase 13P.3: kanban view scoped to standalone tasks of a workspace.
 *
 * Standalone = task with no convoy_id, not is_subtask=1, not the parent of any
 * convoy. The MissionQueue filters by `standaloneOnly` + an `excludeIds`
 * list of mission-parent task IDs we fetch on mount.
 */
export default function StandaloneTasksKanbanPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [missionParentIds, setMissionParentIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useSSE();

  const loadAll = useCallback(async () => {
    try {
      const wsRes = await fetch(`/api/workspaces/${slug}`);
      if (!wsRes.ok) {
        setError(`Workspace not found (${wsRes.status})`);
        return;
      }
      const ws = await wsRes.json();
      setWorkspace(ws);

      const mRes = await fetch(`/api/missions?workspace_id=${ws.id}`);
      if (mRes.ok) {
        const data = await mRes.json();
        const parents = (Array.isArray(data) ? data : data.items ?? [])
          .map((m: { parent_task?: { id?: string }; parent_task_id?: string }) =>
            m.parent_task?.id ?? m.parent_task_id ?? null
          )
          .filter((x: unknown): x is string => typeof x === 'string');
        setMissionParentIds(parents);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [slug]);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-mc-accent-red text-sm">
        {error}
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="h-full flex items-center justify-center text-mc-text-secondary text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading workspace…
      </div>
    );
  }

  return (
    <>
      <Header workspace={workspace} isPortrait={false} />
      <div className="border-b border-mc-border bg-mc-bg-secondary/30 px-4 py-3 flex items-center gap-3">
        <Link
          href={`/workspace/${slug}`}
          className="flex items-center gap-1 text-xs text-mc-text-secondary hover:text-mc-text border border-mc-border rounded px-2 py-1 hover:bg-mc-bg-tertiary"
          title="Back to workspace"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Workspace
        </Link>
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-mc-accent-cyan" />
          <h1 className="text-sm font-semibold text-mc-text">Standalone tasks · Kanban</h1>
        </div>
        <p className="text-[11px] text-mc-text-secondary ml-2 flex-1">
          Tasks not attached to any mission. Drag between columns to change status.
        </p>
        <button
          onClick={loadAll}
          className="flex items-center gap-1.5 px-2.5 min-h-9 rounded-lg border border-mc-border bg-mc-bg text-xs text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary"
          title="Refresh standalone tasks and missions list"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <AgentsSidebar workspaceId={workspace.id} />
        <MissionQueue
          workspaceId={workspace.id}
          standaloneOnly
          excludeIds={missionParentIds}
        />
        <LiveFeed />
      </div>
    </>
  );
}
