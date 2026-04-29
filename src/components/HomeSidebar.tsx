'use client';

import Link from 'next/link';
import { Rocket, Activity } from 'lucide-react';
import { WorkspaceSwitcher } from './sidebar/WorkspaceSwitcher';
import { TokenSpendWidget } from './sidebar/TokenSpendWidget';

interface HomeSidebarProps {
  onCreateWorkspace: () => void;
}

export function HomeSidebar({ onCreateWorkspace }: HomeSidebarProps) {
  return (
    <aside className="w-64 shrink-0 flex flex-col border-r border-mc-border bg-mc-bg-secondary h-full overflow-y-auto">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-mc-border">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🦞</span>
          <div>
            <h1 className="text-sm font-bold leading-tight">Mission Control</h1>
            <p className="text-xs text-mc-text-secondary">OpenClaw</p>
          </div>
        </div>
      </div>

      {/* Workspace list */}
      <div className="flex-1 py-3 overflow-y-auto">
        <p className="px-4 pb-1.5 text-xs font-medium text-mc-text-secondary uppercase tracking-wider">Workspaces</p>
        <WorkspaceSwitcher onCreateWorkspace={onCreateWorkspace} />
      </div>

      {/* Divider */}
      <div className="border-t border-mc-border" />

      {/* Token widget */}
      <div className="py-3">
        <TokenSpendWidget />
      </div>

      {/* Divider */}
      <div className="border-t border-mc-border" />

      {/* Nav footer */}
      <div className="px-2 py-3 flex flex-col gap-0.5">
        <Link
          href="/autopilot"
          className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text transition-colors"
        >
          <Rocket className="w-4 h-4" />
          Autopilot
        </Link>
        <Link
          href="/activity"
          className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text transition-colors"
        >
          <Activity className="w-4 h-4" />
          Activity
        </Link>
      </div>
    </aside>
  );
}
