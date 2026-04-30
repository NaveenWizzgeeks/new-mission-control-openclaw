'use client';

import { useCallback, useState } from 'react';
import { Layers, Loader2, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { TeamTab } from '@/components/TeamTab';

interface MissionTeamTabProps {
  missionId: string;
  parentTaskId: string;
  workspaceId: string;
}

interface SyncResult {
  ok: boolean;
  updated_subtasks: number;
  workflow_template_id: string | null;
  roles_synced: number;
}

export function MissionTeamTab({ missionId, parentTaskId, workspaceId }: MissionTeamTabProps) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumping this key remounts the underlying TeamTab so it re-fetches its
  // local state after we've sync'd to subtasks (and to refresh after the
  // parent task's role/workflow changes).
  const [reloadKey, setReloadKey] = useState(0);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/team/sync`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Sync failed (${res.status})`);
        return;
      }
      setResult(data as SyncResult);
      setReloadKey(k => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [missionId]);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
        <div className="flex items-start gap-3 mb-4">
          <Layers className="w-5 h-5 text-mc-accent mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-mc-text">Mission Workflow &amp; Team</h3>
            <p className="text-xs text-mc-text-secondary mt-1">
              Pick a workflow template and assign agents to each role. Once saved,
              click <strong>Apply to all subtasks</strong> below to propagate this
              configuration across every task in this mission. Without this, the
              autensa stage handoff (testing → tester, review → reviewer, etc.)
              has nothing to look up at each transition.
            </p>
          </div>
        </div>

        {/* Re-use the existing TeamTab as-is — it operates on the parent task. */}
        <div className="-mx-5 -mb-5 mt-5 border-t border-mc-border bg-mc-bg/40 rounded-b-xl px-5 py-5">
          <TeamTab key={reloadKey} taskId={parentTaskId} workspaceId={workspaceId} />
        </div>
      </div>

      {/* Apply-to-subtasks card */}
      <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
        <div className="flex items-start gap-3">
          <RefreshCw className="w-5 h-5 text-mc-accent-purple mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-mc-text mb-1">Apply to all subtasks</h3>
            <p className="text-xs text-mc-text-secondary mb-3">
              Copies the parent task&apos;s workflow template + role assignments to every
              subtask of this mission. Replaces existing subtask <code>task_roles</code>.
              Run this every time you change the team above.
            </p>
            <button
              onClick={sync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90 disabled:opacity-50"
            >
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {syncing ? 'Syncing…' : 'Apply to all subtasks'}
            </button>

            {result && (
              <div className="mt-3 flex items-start gap-2 text-xs text-mc-accent-green bg-mc-accent-green/10 border border-mc-accent-green/30 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Synced {result.roles_synced} role{result.roles_synced === 1 ? '' : 's'} across {result.updated_subtasks} subtask{result.updated_subtasks === 1 ? '' : 's'}
                  {result.workflow_template_id ? '.' : ' (no workflow template selected — only role assignments propagated).'}
                </span>
              </div>
            )}
            {error && (
              <div className="mt-3 flex items-start gap-2 text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
