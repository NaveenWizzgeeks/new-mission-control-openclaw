'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Rocket, Activity, ChevronLeft, ChevronRight, Briefcase } from 'lucide-react';

const STORAGE_KEY = 'mc-sidebar-collapsed';

export function HomeSidebar() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === '1') setCollapsed(true);
  }, []);

  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev;
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  };

  return (
    <aside
      className={`sticky top-0 h-screen shrink-0 flex flex-col border-r border-mc-border bg-mc-bg-secondary transition-[width] duration-200 ${
        collapsed ? 'w-14' : 'w-64'
      }`}
    >
      {/* Logo + collapse toggle */}
      <div className="px-3 py-4 border-b border-mc-border flex items-center gap-2">
        <span className="text-2xl shrink-0">🦞</span>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold leading-tight truncate">Mission Control</h1>
            <p className="text-xs text-mc-text-secondary truncate">OpenClaw</p>
          </div>
        )}
        <button
          onClick={toggle}
          className="text-mc-text-secondary hover:text-mc-text shrink-0 p-1 rounded hover:bg-mc-bg-tertiary"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
        <NavLink href="/workspaces" label="Workspaces" icon={<Briefcase className="w-4 h-4" />} collapsed={collapsed} />
        <NavLink href="/autopilot" label="Autopilot" icon={<Rocket className="w-4 h-4" />} collapsed={collapsed} />
        <NavLink href="/activity" label="Activity" icon={<Activity className="w-4 h-4" />} collapsed={collapsed} />
      </nav>
    </aside>
  );
}

function NavLink({
  href,
  label,
  icon,
  collapsed,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={`flex items-center gap-2 rounded-lg text-sm text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text transition-colors ${
        collapsed ? 'justify-center p-2' : 'px-2 py-2'
      }`}
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}
