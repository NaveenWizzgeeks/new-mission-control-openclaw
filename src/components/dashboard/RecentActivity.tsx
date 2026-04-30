'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Event } from '@/lib/types';

const POLL_MS = 15_000;

const TYPE_ACCENT: Record<string, string> = {
  task_completed: 'text-mc-accent-green',
  task_status_changed: 'text-mc-accent-cyan',
  task_assigned: 'text-mc-accent-blue',
  task_created: 'text-mc-accent-purple',
  agent_status_changed: 'text-mc-accent-yellow',
  message_sent: 'text-mc-text',
  agent_joined: 'text-mc-accent',
  system: 'text-mc-text-secondary',
};

export function RecentActivity() {
  const [events, setEvents] = useState<Event[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/events?limit=10');
      if (res.ok) {
        const data: Event[] = await res.json();
        setEvents(Array.isArray(data) ? data : []);
      }
    } catch {
      setEvents(prev => prev ?? []);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5 flex flex-col max-h-[24rem]">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-mc-accent-cyan" />
          <p className="text-sm font-medium uppercase tracking-wider text-mc-text-secondary">Recent Activity</p>
        </div>
        {events && events.length > 0 && (
          <span className="text-xs text-mc-text-secondary tabular-nums">{events.length}</span>
        )}
      </div>

      {events === null ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-10 rounded-lg bg-mc-bg-tertiary animate-pulse" />)}
        </div>
      ) : events.length === 0 ? (
        <p className="text-mc-text-secondary text-sm">No recent activity</p>
      ) : (
        <ul className="space-y-1 overflow-y-auto -mr-2 pr-2">
          {events.map(ev => (
            <li
              key={ev.id}
              className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-mc-bg-tertiary text-xs"
            >
              <span className="text-base leading-none shrink-0 mt-0.5">
                {ev.agent?.avatar_emoji ?? '·'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-mc-text leading-snug truncate" title={ev.message}>
                  {ev.agent?.name && (
                    <span className="font-medium">{ev.agent.name}</span>
                  )}
                  {ev.agent?.name ? ' · ' : ''}
                  <span className={TYPE_ACCENT[ev.type] ?? 'text-mc-text-secondary'}>
                    {ev.message}
                  </span>
                </p>
                <p className="text-[10px] text-mc-text-secondary mt-0.5">
                  {ev.task?.title ? (
                    <>
                      <span className="truncate">{ev.task.title}</span>
                      <span> · </span>
                    </>
                  ) : null}
                  {formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
