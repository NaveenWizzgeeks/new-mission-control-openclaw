'use client';

import { HomeSidebar } from '@/components/HomeSidebar';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex bg-mc-bg overflow-hidden">
      <HomeSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
