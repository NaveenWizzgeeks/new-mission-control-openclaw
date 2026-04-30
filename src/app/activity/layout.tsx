'use client';

import { HomeSidebar } from '@/components/HomeSidebar';

export default function ActivityLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex bg-mc-bg overflow-hidden">
      <HomeSidebar />
      <main className="flex-1 min-w-0 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
