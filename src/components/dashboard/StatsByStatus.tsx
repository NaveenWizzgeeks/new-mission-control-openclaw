'use client';

import { useState, useEffect } from 'react';

const STATUS_ORDER = [
  'planning', 'inbox', 'assigned', 'in_progress', 'convoy_active',
  'testing', 'review', 'verification', 'done', 'pending_dispatch',
];

const STATUS_LABELS: Record<string, string> = {
  planning: 'Planning',
  inbox: 'Inbox',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  convoy_active: 'Convoy',
  testing: 'Testing',
  review: 'Review',
  verification: 'Verification',
  done: 'Done',
  pending_dispatch: 'Pending',
};

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-mc-accent-purple',
  inbox: 'bg-mc-accent-pink',
  assigned: 'bg-mc-accent-yellow',
  in_progress: 'bg-mc-accent',
  convoy_active: 'bg-cyan-400',
  testing: 'bg-mc-accent-cyan',
  review: 'bg-mc-accent-purple',
  verification: 'bg-orange-500',
  done: 'bg-mc-accent-green',
  pending_dispatch: 'bg-mc-text-secondary',
};

export function StatsByStatus() {
  const [byStatus, setByStatus] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    fetch('/api/stats/tasks')
      .then(r => r.ok ? r.json() : null)
      .then(d => setByStatus(d?.by_status ?? null))
      .catch(() => setByStatus(null));
  }, []);

  const statuses = STATUS_ORDER.filter(s => byStatus && (byStatus[s] ?? 0) > 0);
  const max = byStatus ? Math.max(...Object.values(byStatus), 1) : 1;

  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
      <p className="text-sm font-medium uppercase tracking-wider text-mc-text-secondary mb-4">By Status</p>
      {byStatus === null ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-5 rounded bg-mc-bg-tertiary animate-pulse" />)}
        </div>
      ) : statuses.length === 0 ? (
        <p className="text-mc-text-secondary text-sm">No tasks yet</p>
      ) : (
        <div className="space-y-2">
          {statuses.map(s => (
            <div key={s} className="flex items-center gap-2">
              <span className="text-xs text-mc-text-secondary w-24 shrink-0">{STATUS_LABELS[s] ?? s}</span>
              <div className="flex-1 h-2 rounded-full bg-mc-bg-tertiary overflow-hidden">
                <div
                  className={`h-full rounded-full ${STATUS_COLORS[s] ?? 'bg-mc-accent'}`}
                  style={{ width: `${((byStatus[s] ?? 0) / max) * 100}%` }}
                />
              </div>
              <span className="text-xs font-mono text-mc-text w-6 text-right">{byStatus[s]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
