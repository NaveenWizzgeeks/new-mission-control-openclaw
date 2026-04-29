'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Trash2, Folder, Users, CheckSquare } from 'lucide-react';
import { emitRefresh } from '@/hooks/useDataRefresh';
import type { WorkspaceStats } from '@/lib/types';

interface WorkspaceRow extends WorkspaceStats {
  path: string | null;
  description: string | null;
  created_at: string;
}

interface WorkspaceManagerProps {
  rows: WorkspaceRow[] | null;
  onChanged: () => void;
}

export function WorkspaceManager({ rows, onChanged }: WorkspaceManagerProps) {
  const [pendingDelete, setPendingDelete] = useState<WorkspaceRow | null>(null);

  if (rows === null) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 rounded-xl bg-mc-bg-secondary animate-pulse" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-10 text-center">
        <p className="text-mc-text-secondary">No workspaces yet. Create one to get started.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {rows.map(ws => {
          const isDefault = ws.id === 'default';
          return (
            <li key={ws.id} className="relative group bg-mc-bg-secondary border border-mc-border rounded-xl hover:border-mc-accent/50 transition-colors">
              <Link
                href={`/workspace/${ws.slug}`}
                className="flex items-start gap-4 p-5 pr-14"
              >
                <span className="text-3xl leading-none shrink-0">{ws.icon}</span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold flex items-center gap-1.5">
                      {ws.name}
                      <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                    </span>
                    <span className="text-xs font-mono text-mc-text-secondary">/{ws.slug}</span>
                    {isDefault && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-mc-bg-tertiary text-mc-text-secondary">default</span>
                    )}
                  </div>

                  {ws.description && (
                    <p className="text-sm text-mc-text-secondary mb-2">{ws.description}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mc-text-secondary">
                    <span className="flex items-center gap-1.5">
                      <Folder className="w-3.5 h-3.5" />
                      {ws.path ? <span className="font-mono text-mc-text">{ws.path}</span> : <span className="italic">no working directory</span>}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" />
                      {ws.agentCount} agent{ws.agentCount === 1 ? '' : 's'}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <CheckSquare className="w-3.5 h-3.5" />
                      {ws.taskCounts.total} task{ws.taskCounts.total === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              </Link>

              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPendingDelete(ws); }}
                disabled={isDefault}
                title={isDefault ? "Can't delete the default workspace" : 'Delete workspace'}
                className="absolute top-4 right-4 z-10 p-2 rounded-lg text-mc-text-secondary hover:text-mc-accent-red hover:bg-mc-accent-red/10 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-mc-text-secondary"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          );
        })}
      </ul>

      {pendingDelete && (
        <DeleteConfirmDialog
          workspace={pendingDelete}
          onClose={() => setPendingDelete(null)}
          onDeleted={() => {
            setPendingDelete(null);
            emitRefresh('workspaces');
            emitRefresh('agents');
            onChanged();
          }}
        />
      )}
    </>
  );
}

interface DeleteConfirmDialogProps {
  workspace: WorkspaceRow;
  onClose: () => void;
  onDeleted: () => void;
}

function DeleteConfirmDialog({ workspace, onClose, onDeleted }: DeleteConfirmDialogProps) {
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blockedByTasks = workspace.taskCounts.total > 0;
  const matches = confirmText.trim() === workspace.name;

  const submit = async () => {
    if (blockedByTasks || !matches) return;
    setSubmitting(true);
    setError(null);
    try {
      const force = workspace.agentCount > 0 ? '?force=true' : '';
      const res = await fetch(`/api/workspaces/${workspace.id}${force}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Delete failed');
      }
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-xl w-full max-w-md">
        <div className="p-6 border-b border-mc-border">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-mc-accent-red" />
            Delete workspace
          </h3>
        </div>

        <div className="p-6 space-y-4 text-sm">
          {blockedByTasks ? (
            <p className="text-mc-text">
              <span className="font-semibold">{workspace.name}</span> has {workspace.taskCounts.total} task(s).
              Delete its tasks first before removing the workspace.
            </p>
          ) : (
            <>
              <p>
                This will permanently delete <span className="font-semibold">{workspace.name}</span>
                {workspace.agentCount > 0 && (
                  <> along with its <span className="font-semibold">{workspace.agentCount} agent(s)</span></>
                )}
                . This cannot be undone.
              </p>
              <div>
                <label className="block text-xs text-mc-text-secondary mb-1.5">
                  Type <span className="font-mono text-mc-text">{workspace.name}</span> to confirm
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-mc-accent-red"
                  autoFocus
                />
              </div>
            </>
          )}
          {error && <div className="text-mc-accent-red text-sm">{error}</div>}
        </div>

        <div className="p-6 border-t border-mc-border flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-mc-text-secondary hover:text-mc-text">
            {blockedByTasks ? 'Close' : 'Cancel'}
          </button>
          {!blockedByTasks && (
            <button
              onClick={submit}
              disabled={!matches || submitting}
              className="px-4 py-2 text-sm bg-mc-accent-red text-white rounded-lg font-medium hover:bg-mc-accent-red/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Deleting…' : 'Delete workspace'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
