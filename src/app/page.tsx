'use client';

import { HomeSidebar } from '@/components/HomeSidebar';
import { HomeDashboard } from '@/components/HomeDashboard';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-mc-bg flex">
      <HomeSidebar />
      <HomeDashboard />
    </div>
  );
}
