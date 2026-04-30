'use client';

import { HomeSidebar } from '@/components/HomeSidebar';
import { HomeDashboard } from '@/components/HomeDashboard';

export default function HomePage() {
  return (
    <div className="h-full flex bg-mc-bg overflow-hidden">
      <HomeSidebar />
      <HomeDashboard />
    </div>
  );
}
