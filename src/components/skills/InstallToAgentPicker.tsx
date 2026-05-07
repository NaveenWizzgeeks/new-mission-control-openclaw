'use client';

import { Crown } from 'lucide-react';

export interface AgentOption {
  id: string;
  name: string;
  role?: string;
  is_lead?: number | boolean;
  is_global?: number | boolean;
}

interface InstallToAgentPickerProps {
  agents: AgentOption[];
  value: string;
  onChange: (agentId: string) => void;
  disabled?: boolean;
  label?: string;
}

export function InstallToAgentPicker({
  agents,
  value,
  onChange,
  disabled,
  label = 'Install on agent',
}: InstallToAgentPickerProps) {
  if (agents.length === 0) {
    return <p className="text-xs text-mc-text-secondary">No agents available. Create one first.</p>;
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary">
        {label}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full min-h-9 bg-mc-bg border border-mc-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-mc-accent disabled:opacity-50"
      >
        {agents.map(a => (
          <option key={a.id} value={a.id}>
            {a.is_lead ? '👑 ' : ''}{a.name}{a.role ? ` — ${a.role}` : ''}{a.is_global ? ' (global)' : ''}
          </option>
        ))}
      </select>
      {agents.find(a => a.id === value)?.is_lead ? (
        <p className="flex items-center gap-1 text-[11px] text-mc-accent-yellow">
          <Crown className="w-3 h-3" /> Lead agent — installed skills inject into every dispatch.
        </p>
      ) : null}
    </div>
  );
}
