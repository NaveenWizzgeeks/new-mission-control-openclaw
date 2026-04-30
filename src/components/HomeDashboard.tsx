'use client';

import { HeroStats } from './dashboard/HeroStats';
import { AgentRoster } from './dashboard/AgentRoster';
import { WorkspacesList } from './dashboard/WorkspacesList';
import { RecentMissions } from './dashboard/RecentMissions';
import { RecentActivity } from './dashboard/RecentActivity';
import { ActiveMissionCard } from './dashboard/ActiveMissionCard';
import { QuickLinks } from './dashboard/QuickLinks';

export function HomeDashboard() {
  return (
    <main className="flex-1 overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Hero band */}
        <div>
          <h2 className="text-2xl font-bold mb-1">Mission Control</h2>
          <p className="text-mc-text-secondary text-sm">Workspaces, agents, and the live state of every mission.</p>
        </div>

        {/* Active mission front-and-center (per Nexus rule: only one active at a time) */}
        <ActiveMissionCard />

        {/* Counter row */}
        <HeroStats />

        {/* Quick links band */}
        <QuickLinks />

        {/* Recent activity + agent roster pair — equal height, internal scroll */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <RecentActivity />
          </div>
          <AgentRoster />
        </div>

        {/* Workspaces + recent missions pair — equal height, internal scroll */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <WorkspacesList />
          <RecentMissions />
        </div>
      </div>
    </main>
  );
}
