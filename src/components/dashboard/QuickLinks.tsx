'use client';

import Link from 'next/link';
import { Briefcase, MessageSquare, BarChart3, Bot, Plus } from 'lucide-react';

const LINKS = [
  { href: '/workspaces', label: 'Workspaces', desc: 'All projects', icon: Briefcase, accent: 'text-mc-accent-purple' },
  { href: '/chat', label: 'Open Chat', desc: 'Talk to an agent', icon: MessageSquare, accent: 'text-mc-accent' },
  { href: '/sessions', label: 'Sessions', desc: 'Tokens & cost', icon: BarChart3, accent: 'text-mc-accent-green' },
  { href: '/agents', label: 'Agents', desc: 'Skills & lead', icon: Bot, accent: 'text-mc-accent-yellow' },
];

export function QuickLinks() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {LINKS.map(l => {
        const Icon = l.icon;
        return (
          <Link
            key={l.href}
            href={l.href}
            className="group flex items-center gap-3 px-4 py-3 rounded-xl bg-mc-bg-secondary border border-mc-border hover:border-mc-accent/50 hover:bg-mc-bg-tertiary/40 transition-colors"
          >
            <div className={`w-9 h-9 rounded-lg bg-mc-bg-tertiary flex items-center justify-center ${l.accent}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-mc-text group-hover:text-mc-accent transition-colors">{l.label}</p>
              <p className="text-[11px] text-mc-text-secondary truncate">{l.desc}</p>
            </div>
            <Plus className="w-3.5 h-3.5 text-mc-text-secondary/50 group-hover:text-mc-accent transition-colors" />
          </Link>
        );
      })}
    </div>
  );
}
