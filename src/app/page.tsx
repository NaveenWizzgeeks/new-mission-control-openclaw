'use client';

import { HomeSidebar } from '@/components/HomeSidebar';
import { HomeDashboard } from '@/components/HomeDashboard';

export default function HomePage() {
  return (
    <div className="h-screen flex bg-mc-bg overflow-hidden">
      <HomeSidebar />
      <HomeDashboard />
    </div>
  );
}
