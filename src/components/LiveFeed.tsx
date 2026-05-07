'use client';

import { useState, useMemo } from 'react';
import { ChevronRight, ChevronLeft, Clock } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import type { Event, Task } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';

type FeedFilter = 'all' | 'tasks' | 'agents';

interface LiveFeedProps {
  mobileMode?: boolean;
  isPortrait?: boolean;
  /** Phase 13S.8: scope events to a single mission (convoy). When set, only
   * events for tasks belonging to this convoy (parent + subtasks) are shown.
   * Leave undefined for the workspace/dashboard-wide feed. */
  missionId?: string;
}

export function LiveFeed({ mobileMode = false, isPortrait = true, missionId }: LiveFeedProps) {
  const { events, tasks } = useMissionControl();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [isMinimized, setIsMinimized] = useState(false);

  const effectiveMinimized = mobileMode ? false : isMinimized;
  const toggleMinimize = () => setIsMinimized(!isMinimized);

  // Build the set of task IDs that belong to this mission so we can filter
  // events down. Includes the parent task (whose convoy_id is null but whose
  // own id matches missionId in our schema) and every subtask.
  const missionTaskIds = missionId
    ? new Set([
        missionId,
        ...tasks.filter(t => t.convoy_id === missionId).map(t => t.id),
      ])
    : null;

  const filteredEvents = events.filter((event) => {
    if (missionTaskIds) {
      // Drop anything we can't tie to this mission. System/global events
      // (no task_id) are intentionally hidden in the per-mission view.
      if (!event.task_id || !missionTaskIds.has(event.task_id)) return false;
    }
    if (filter === 'all') return true;
    if (filter === 'tasks') return ['task_created', 'task_assigned', 'task_status_changed', 'task_completed'].includes(event.type);
    if (filter === 'agents') return ['agent_joined', 'agent_status_changed', 'message_sent'].includes(event.type);
    return true;
  });

  // Phase 13S.10: when showing the global feed (no missionId), each event
  // gets a mission tag so the user can tell which project an event belongs
  // to. Build a lookup once per render.
  const taskToMission = useMemo(() => {
    if (missionId) return null; // not needed in scoped view
    const map = new Map<string, string>();
    for (const t of tasks as Task[]) {
      if (t.convoy_id) map.set(t.id, t.convoy_id);
    }
    return map;
  }, [tasks, missionId]);

  const missionNameById = useMemo(() => {
    if (missionId) return null;
    const map = new Map<string, string>();
    for (const t of tasks as Task[]) {
      // The parent task's id IS the convoy id in our schema; its title is the
      // mission name shown in the UI.
      if (!t.convoy_id && !t.is_subtask) map.set(t.id, t.title);
    }
    return map;
  }, [tasks, missionId]);

  return (
    <aside
      className={`bg-mc-bg-secondary ${mobileMode ? 'border border-mc-border rounded-lg h-full' : 'border-l border-mc-border'} flex flex-col transition-all duration-300 ease-in-out ${
        effectiveMinimized ? 'w-12' : mobileMode ? 'w-full' : 'w-80'
      }`}
    >
      <div className="p-3 border-b border-mc-border">
        <div className="flex items-center">
          {!mobileMode && (
            <button
              onClick={toggleMinimize}
              className="p-1 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text transition-colors"
              aria-label={effectiveMinimized ? 'Expand feed' : 'Minimize feed'}
            >
              {effectiveMinimized ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          )}
          {!effectiveMinimized && <span className="text-sm font-medium uppercase tracking-wider">Live Feed</span>}
        </div>

        {!effectiveMinimized && (
          <div className={`mt-3 ${mobileMode && isPortrait ? 'grid grid-cols-3 gap-2' : 'flex gap-1'}`}>
            {(['all', 'tasks', 'agents'] as FeedFilter[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`min-h-11 text-xs rounded uppercase ${mobileMode && isPortrait ? 'px-1' : 'px-3'} ${
                  filter === tab ? 'bg-mc-accent text-mc-bg font-medium' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        )}
      </div>

      {!effectiveMinimized && (
        <div className="flex-1 overflow-y-auto p-2 space-y-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          {filteredEvents.length === 0 ? (
            <div className="text-center py-8 text-mc-text-secondary text-sm">No events yet</div>
          ) : (
            filteredEvents.map((event) => {
              const missionTag = !missionId && event.task_id && taskToMission && missionNameById
                ? missionNameById.get(taskToMission.get(event.task_id) ?? '')
                : undefined;
              return <EventItem key={event.id} event={event} missionTag={missionTag} />;
            })
          )}
        </div>
      )}
    </aside>
  );
}

function EventItem({ event, missionTag }: { event: Event; missionTag?: string }) {
  const getEventIcon = (type: string) => {
    switch (type) {
      case 'task_created':
        return '📋';
      case 'task_assigned':
        return '👤';
      case 'task_status_changed':
        return '🔄';
      case 'task_completed':
        return '✅';
      case 'message_sent':
        return '💬';
      case 'agent_joined':
        return '🎉';
      case 'agent_status_changed':
        return '🔔';
      case 'system':
        return '⚙️';
      case 'task_dispatched':
        return '🚀';
      case 'convoy_created':
        return '🚚';
      case 'convoy_completed':
        return '🏁';
      default:
        return '📌';
    }
  };

  const isTaskEvent = ['task_created', 'task_assigned', 'task_completed'].includes(event.type);
  const isHighlight = event.type === 'task_created' || event.type === 'task_completed';

  return (
    <div
      className={`p-2 rounded border-l-2 animate-slide-in ${
        isHighlight ? 'bg-mc-bg-tertiary border-mc-accent-pink' : 'bg-transparent border-transparent hover:bg-mc-bg-tertiary'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-sm">{getEventIcon(event.type)}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${isTaskEvent ? 'text-mc-accent-pink' : 'text-mc-text'}`}>{event.message}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-mc-text-secondary flex-wrap">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
            </span>
            {missionTag && (
              <span
                className="px-1.5 py-0.5 rounded bg-mc-bg-tertiary text-[10px] text-mc-accent truncate max-w-[10rem]"
                title={`Mission: ${missionTag}`}
              >
                🎯 {missionTag}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
