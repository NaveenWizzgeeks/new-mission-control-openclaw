'use client';

import { useState } from 'react';
import { Sparkles, Check, Loader2, AlertCircle } from 'lucide-react';
import type { ProposalSpec } from './parseProposals';

interface ProposalCardProps {
  missionId: string;
  subtasks: ProposalSpec[];
  /** Notify parent (e.g., the Ask Fury tab) when subtasks are accepted so it
   *  can refresh the mission. */
  onAccepted?: (count: number) => void;
}

const ROLE_LABEL: Record<string, string> = {
  planner: 'Planner',
  builder: 'Builder',
  tester: 'Tester',
  reviewer: 'Reviewer',
  general: 'General',
};

/**
 * Renders the parsed subtask spec inline beneath Fury's reply with a single
 * "Add to Proposed" action that funnels them into the mission's existing
 * planner_proposed flow. After accepting, the card collapses to a confirmation
 * row so the same proposal can't be added twice.
 */
export function ProposalCard({ missionId, subtasks, onAccepted }: ProposalCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<{ inserted: number; total_proposed: number } | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/proposals/from-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtasks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Failed to add (${res.status})`);
        return;
      }
      setAccepted({ inserted: data.inserted ?? 0, total_proposed: data.total_proposed ?? 0 });
      onAccepted?.(data.inserted ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  };

  if (accepted) {
    return (
      <div className="my-2 rounded-lg border border-mc-accent-green/30 bg-mc-accent-green/5 px-3 py-2 flex items-center gap-2">
        <Check className="w-4 h-4 text-mc-accent-green shrink-0" />
        <span className="text-xs text-mc-text">
          {accepted.inserted > 0
            ? `Added ${accepted.inserted} subtask${accepted.inserted === 1 ? '' : 's'} to Proposed.`
            : 'Already in Proposed (deduped by title).'}
          {' '}
          <span className="text-mc-text-secondary">Review them in the Tasks tab.</span>
        </span>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg border border-mc-accent-purple/30 bg-mc-accent-purple/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-mc-accent-purple/20 bg-mc-accent-purple/10">
        <Sparkles className="w-3.5 h-3.5 text-mc-accent-purple shrink-0" />
        <span className="text-[11px] uppercase tracking-wider font-medium text-mc-accent-purple">
          Fury proposed {subtasks.length} subtask{subtasks.length === 1 ? '' : 's'}
        </span>
      </div>

      <ul className="divide-y divide-mc-border/40">
        {subtasks.map((s, i) => (
          <li key={i} className="px-3 py-2">
            <div className="flex items-start gap-2">
              <span className="text-[10px] font-mono tabular-nums text-mc-text-secondary mt-0.5 shrink-0">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-mc-text">{s.title}</span>
                  {s.agent_role && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-mc-border bg-mc-bg-tertiary text-mc-text-secondary">
                      {ROLE_LABEL[s.agent_role] ?? s.agent_role}
                    </span>
                  )}
                  {s.needs_planning && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-mc-accent-blue/40 bg-mc-accent-blue/10 text-mc-accent-blue">
                      needs planning
                    </span>
                  )}
                </div>
                {s.description && (
                  <p className="text-xs text-mc-text-secondary mt-1 leading-relaxed whitespace-pre-wrap">
                    {s.description}
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-mc-bg-secondary/40 border-t border-mc-border/40">
        {error ? (
          <span className="flex items-center gap-1.5 text-xs text-mc-accent-red">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </span>
        ) : (
          <span className="text-[11px] text-mc-text-secondary">
            Lands in the Proposed column — same as auto-propose. Approve or reject from there.
          </span>
        )}
        <button
          onClick={submit}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-mc-accent-purple text-white text-xs font-medium hover:bg-mc-accent-purple/90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Add {subtasks.length} to Proposed
        </button>
      </div>
    </div>
  );
}
