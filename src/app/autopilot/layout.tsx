'use client';

import { HomeSidebar } from '@/components/HomeSidebar';

export default function AutopilotLayout({ children }: { children: React.ReactNode }) {
  // Autopilot pages keep their own internal scroll & min-h-screen layout, so
  // the main pane is overflow-y-auto here (rather than overflow-hidden like
  // the mission pages where MissionQueue has its own kanban scroll).
  return (
    <div className="h-full flex bg-mc-bg overflow-hidden">
      <HomeSidebar />
      <main className="flex-1 min-w-0 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
