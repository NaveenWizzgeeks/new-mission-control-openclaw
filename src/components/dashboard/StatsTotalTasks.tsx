'use client';

import { useState, useEffect } from 'react';
import { CheckSquare } from 'lucide-react';

interface TaskStats {
  total: number;
  by_status: Record<string, number>;
}

export function StatsTotalTasks() {
  const [stats, setStats] = useState<TaskStats | null>(null);

  useEffect(() => {
    fetch('/api/stats/tasks')
      .then(r => r.ok ? r.json() : null)
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3 text-mc-text-secondary">
        <CheckSquare className="w-4 h-4" />
        <span className="text-sm font-medium uppercase tracking-wider">Total Tasks</span>
      </div>
      <p className="text-4xl font-bold">
        {stats === null ? <span className="text-mc-text-secondary text-2xl">—</span> : stats.total}
      </p>
    </div>
  );
}
