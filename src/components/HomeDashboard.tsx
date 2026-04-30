'use client';

import { HeroStats } from './dashboard/HeroStats';
import { AgentRoster } from './dashboard/AgentRoster';
import { WorkspacesList } from './dashboard/WorkspacesList';
import { RecentMissions } from './dashboard/RecentMissions';
import { RecentActivity } from './dashboard/RecentActivity';
import { TokenUsageCard } from './dashboard/TokenUsageCard';

export function HomeDashboard() {
  return (
    <main className="flex-1 overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-1">Mission Control</h2>
          <p className="text-mc-text-secondary text-sm">All workspaces, agents, and tasks at a glance</p>
        </div>

        <HeroStats />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <WorkspacesList />
          </div>
          <AgentRoster />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <RecentMissions />
          </div>
          <TokenUsageCard />
        </div>

        <RecentActivity />
      </div>
    </main>
  );
}
