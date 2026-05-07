'use client';

import { Star, Download, Terminal, Server, FileText, Lock, BadgeCheck, Building2, Cpu, Globe } from 'lucide-react';
import type { MarketplaceListItem } from '@/lib/skills-marketplace/types';
import type { SkillType } from '@/lib/agentSkills';

const TYPE_BADGE: Record<SkillType, string> = {
  shell: 'bg-mc-accent-yellow/15 text-mc-accent-yellow border-mc-accent-yellow/40',
  mcp: 'bg-mc-accent-purple/15 text-mc-accent-purple border-mc-accent-purple/40',
  prompt_inject: 'bg-mc-accent-blue/15 text-mc-accent-blue border-mc-accent-blue/40',
  file_access: 'bg-mc-accent-green/15 text-mc-accent-green border-mc-accent-green/40',
};

const TYPE_ICON: Record<SkillType, React.ComponentType<{ className?: string }>> = {
  shell: Terminal,
  mcp: Server,
  prompt_inject: FileText,
  file_access: Lock,
};

const TYPE_LABEL: Record<SkillType, string> = {
  shell: 'Shell',
  mcp: 'MCP',
  prompt_inject: 'Prompt',
  file_access: 'File',
};

interface SkillCardProps {
  skill: MarketplaceListItem;
  onClick: () => void;
}

export function SkillCard({ skill, onClick }: SkillCardProps) {
  const Icon = TYPE_ICON[skill.skill_type];
  const showRating = skill.rating > 0 || skill.rating_count > 0;
  const showInstalls = skill.installs > 0;

  return (
    <button
      onClick={onClick}
      className="text-left flex flex-col gap-2 p-4 rounded-lg border border-mc-border bg-mc-bg-secondary hover:border-mc-accent/50 hover:bg-mc-bg-tertiary transition-colors min-h-[180px]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 text-mc-text-secondary shrink-0" />
          <h3 className="text-sm font-semibold text-mc-text truncate">{skill.name}</h3>
        </div>
        <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${TYPE_BADGE[skill.skill_type]}`}>
          {TYPE_LABEL[skill.skill_type]}
        </span>
      </div>

      {/* ClawHub badges row */}
      {(skill.official || skill.verified || skill.executes_code || skill.source === 'clawhub') && (
        <div className="flex flex-wrap items-center gap-1">
          {skill.source === 'clawhub' && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-mc-accent-cyan/15 text-mc-accent-cyan border border-mc-accent-cyan/40">
              <Globe className="w-2.5 h-2.5" /> ClawHub
            </span>
          )}
          {skill.official && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-mc-accent-blue/15 text-mc-accent-blue border border-mc-accent-blue/40">
              <Building2 className="w-2.5 h-2.5" /> Official
            </span>
          )}
          {skill.verified && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-mc-accent-green/15 text-mc-accent-green border border-mc-accent-green/40">
              <BadgeCheck className="w-2.5 h-2.5" /> Verified
            </span>
          )}
          {skill.executes_code && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-mc-accent-yellow/15 text-mc-accent-yellow border border-mc-accent-yellow/40">
              <Cpu className="w-2.5 h-2.5" /> Executes code
            </span>
          )}
        </div>
      )}

      <p className="text-xs text-mc-text-secondary line-clamp-2 flex-1">{skill.short_description}</p>

      <div className="flex items-center justify-between text-[11px] text-mc-text-secondary mt-auto pt-2 border-t border-mc-border">
        <span className="truncate">{skill.author}{skill.version ? ` · v${skill.version}` : ''}</span>
        <div className="flex items-center gap-3 shrink-0">
          {showRating && (
            <span className="flex items-center gap-1">
              <Star className="w-3 h-3 fill-mc-accent-yellow text-mc-accent-yellow" />
              {skill.rating.toFixed(1)}
              {skill.rating_count > 0 && <span className="opacity-60">({skill.rating_count})</span>}
            </span>
          )}
          {showInstalls && (
            <span className="flex items-center gap-1">
              <Download className="w-3 h-3" />
              {formatInstalls(skill.installs)}
            </span>
          )}
        </div>
      </div>

      {skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skill.tags.slice(0, 4).map(t => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border text-mc-text-secondary">
              {t}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function formatInstalls(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
