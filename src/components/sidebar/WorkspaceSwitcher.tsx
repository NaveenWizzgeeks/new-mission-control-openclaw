'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, CheckSquare } from 'lucide-react';
import type { WorkspaceStats } from '@/lib/types';

interface WorkspaceSwitcherProps {
  activeSlug?: string;
  onCreateWorkspace: () => void;
}

export function WorkspaceSwitcher({ activeSlug, onCreateWorkspace }: WorkspaceSwitcherProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/workspaces?stats=true')
      .then(r => r.ok ? r.json() : [])
      .then(setWorkspaces)
      .catch(() => setWorkspaces([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="px-3 py-2 space-y-1">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-9 rounded-lg bg-mc-bg-tertiary animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 px-2">
      {workspaces.map(ws => (
        <Link
          key={ws.id}
          href={`/workspace/${ws.slug}`}
          className={`flex items-center gap-2 px-2 py-2 rounded-lg transition-colors text-sm ${
            ws.slug === activeSlug
              ? 'bg-mc-accent/10 text-mc-accent'
              : 'text-mc-text hover:bg-mc-bg-tertiary'
          }`}
        >
          <span className="text-lg leading-none">{ws.icon}</span>
          <span className="flex-1 truncate font-medium">{ws.name}</span>
          {ws.taskCounts.total > 0 && (
            <span className="flex items-center gap-1 text-xs text-mc-text-secondary">
              <CheckSquare className="w-3 h-3" />
              {ws.taskCounts.total}
            </span>
          )}
        </Link>
      ))}

      <button
        onClick={onCreateWorkspace}
        className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text transition-colors mt-1"
      >
        <Plus className="w-4 h-4" />
        New Workspace
      </button>
    </div>
  );
}
