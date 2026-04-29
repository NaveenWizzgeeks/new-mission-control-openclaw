'use client';

import { StatsTotalTasks } from './dashboard/StatsTotalTasks';
import { StatsByStatus } from './dashboard/StatsByStatus';
import { AgentRoster } from './dashboard/AgentRoster';

export function HomeDashboard() {
  return (
    <main className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-1">Overview</h2>
          <p className="text-mc-text-secondary text-sm">All workspaces at a glance</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatsTotalTasks />
          <AgentRoster />
        </div>

        <StatsByStatus />
      </div>
    </main>
  );
}
