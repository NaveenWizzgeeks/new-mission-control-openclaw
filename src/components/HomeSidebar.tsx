'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Rocket, Activity, ChevronLeft, ChevronRight, Briefcase, Bot, BarChart3, Clock } from 'lucide-react';
import { SidebarSessions } from './sidebar/SidebarSessions';
import { SidebarTokens } from './sidebar/SidebarTokens';

const STORAGE_KEY = 'mc-sidebar-collapsed';

function isActiveLink(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  if (pathname.startsWith(href + '/')) return true;
  // /workspaces nav also lights up when inside a workspace drilldown
  if (href === '/workspaces' && pathname.startsWith('/workspace/')) return true;
  return false;
}

export function HomeSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

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
      className={`shrink-0 h-full flex flex-col border-r border-mc-border bg-mc-bg-secondary transition-[width] duration-200 ${
        collapsed ? 'w-14' : 'w-64'
      }`}
    >
      {/* Logo (links to dashboard) */}
      <div className="px-3 py-4 border-b border-mc-border flex items-center gap-2 flex-shrink-0">
        <Link
          href="/"
          title="Dashboard"
          className={`flex items-center gap-2 min-w-0 rounded hover:bg-mc-bg-tertiary transition-colors ${
            collapsed ? 'flex-1 justify-center p-1' : 'flex-1 px-1 py-1'
          } ${pathname === '/' ? 'bg-mc-bg-tertiary' : ''}`}
        >
          <span className="text-2xl shrink-0 leading-none">🦞</span>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold leading-tight truncate">Mission Control</h1>
              <p className="text-xs text-mc-text-secondary truncate">OpenClaw</p>
            </div>
          )}
        </Link>
      </div>

      {/* Nav links */}
      <nav className="px-2 py-3 flex flex-col gap-0.5 flex-shrink-0">
        <NavLink href="/workspaces" label="Workspaces" icon={<Briefcase className="w-4 h-4" />} collapsed={collapsed} pathname={pathname} />
        <NavLink href="/agents" label="Agents" icon={<Bot className="w-4 h-4" />} collapsed={collapsed} pathname={pathname} />
        <NavLink href="/sessions" label="Sessions" icon={<BarChart3 className="w-4 h-4" />} collapsed={collapsed} pathname={pathname} />
        <NavLink href="/crons" label="Crons" icon={<Clock className="w-4 h-4" />} collapsed={collapsed} pathname={pathname} />
        <NavLink href="/autopilot" label="Autopilot" icon={<Rocket className="w-4 h-4" />} collapsed={collapsed} pathname={pathname} />
        <NavLink href="/activity" label="Activity" icon={<Activity className="w-4 h-4" />} collapsed={collapsed} pathname={pathname} />
      </nav>

      {/* Dynamic sections — hidden when collapsed */}
      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 flex flex-col gap-0.5 border-t border-mc-border pt-2">
          <SidebarSessions />
          <SidebarTokens />
        </div>
      )}

      {/* Bottom collapse toggle */}
      <div className="border-t border-mc-border px-2 py-2 flex-shrink-0 mt-auto">
        <button
          onClick={toggle}
          className={`w-full flex items-center gap-2 rounded text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text transition-colors text-xs ${
            collapsed ? 'justify-center p-2' : 'px-2 py-2'
          }`}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

function NavLink({
  href,
  label,
  icon,
  collapsed,
  pathname,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  collapsed: boolean;
  pathname: string | null;
}) {
  const active = isActiveLink(pathname, href);
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-mc-accent/15 text-mc-accent font-medium'
          : 'text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text'
      } ${collapsed ? 'justify-center p-2' : 'px-2 py-2'}`}
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}
