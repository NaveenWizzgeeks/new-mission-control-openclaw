'use client';

import { useState } from 'react';
import { HomeSidebar } from '@/components/HomeSidebar';
import { HomeDashboard } from '@/components/HomeDashboard';
import { CreateWorkspaceModal } from '@/components/CreateWorkspaceModal';

export default function HomePage() {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="min-h-screen bg-mc-bg flex">
      <HomeSidebar onCreateWorkspace={() => setShowCreate(true)} />
      <HomeDashboard />

      {showCreate && (
        <CreateWorkspaceModal
          onClose={() => setShowCreate(false)}
          onCreated={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
