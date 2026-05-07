'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Plus, Loader2, Trash2, Edit3, ChevronDown, ChevronRight, ListTodo, AlertCircle,
  Target, RefreshCw, LayoutGrid,
} from 'lucide-react';
import Link from 'next/link';
import { TaskModal } from '@/components/TaskModal';
import { useConfirm } from '@/components/ConfirmDialog';
import { formatDistanceToNow } from 'date-fns';

interface StandaloneTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  assigned_agent_emoji: string | null;
  created_at: string;
  updated_at: string;
  due_date: string | null;
}

interface MissionOption {
  id: string;
  name: string;
  mission_stage: string;
}

interface StandaloneTasksPanelProps {
  workspaceSlug: string;
  workspaceId: string;
  missions: Array<{ id: string; name: string; mission_stage: string }>;
}

const STATUS_BADGE: Record<string, string> = {
  inbox: 'bg-mc-bg-tertiary text-mc-text-secondary border-mc-border',
  planning: 'bg-mc-accent-purple/15 text-mc-accent-purple border-mc-accent-purple/40',
  assigned: 'bg-mc-accent-cyan/15 text-mc-accent-cyan border-mc-accent-cyan/40',
  in_progress: 'bg-mc-accent-yellow/15 text-mc-accent-yellow border-mc-accent-yellow/40',
  testing: 'bg-mc-accent-blue/15 text-mc-accent-blue border-mc-accent-blue/40',
  review: 'bg-mc-accent-blue/15 text-mc-accent-blue border-mc-accent-blue/40',
  done: 'bg-mc-accent-green/15 text-mc-accent-green border-mc-accent-green/40',
};

export function StandaloneTasksPanel({ workspaceSlug, workspaceId, missions }: StandaloneTasksPanelProps) {
  const confirmModal = useConfirm();
  const [items, setItems] = useState<StandaloneTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adoptingId, setAdoptingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/standalone-tasks`);
      if (!res.ok) {
        setError(`Load failed (${res.status})`);
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug]);

  useEffect(() => { load(); }, [load]);

  const remove = async (t: StandaloneTask) => {
    if (!await confirmModal({
      title: `Delete "${t.title}"?`,
      body: 'The standalone task will be removed.',
      confirmLabel: 'Delete',
      danger: true,
    })) return;
    setBusyId(t.id);
    try {
      const res = await fetch(`/api/tasks/${t.id}`, { method: 'DELETE' });
      if (res.ok) await load();
    } finally { setBusyId(null); }
  };

  const adopt = async (taskId: string, missionId: string) => {
    setBusyId(taskId);
    try {
      const res = await fetch(`/api/missions/${missionId}/adopt-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Adopt failed (${res.status})`);
        return;
      }
      setAdoptingId(null);
      await load();
    } finally { setBusyId(null); }
  };

  const editingTask = items?.find(t => t.id === editingId) ?? null;
  const activeMissions: MissionOption[] = missions.filter(m =>
    ['backlog', 'planning', 'in_progress', 'testing', 'paused'].includes(m.mission_stage)
  );

  return (
    <>
      <div className="rounded-xl border border-mc-border bg-mc-bg-secondary/40">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-mc-bg-tertiary/30 rounded-t-xl"
        >
          <div className="flex items-center gap-2">
            {open ? <ChevronDown className="w-4 h-4 text-mc-text-secondary" /> : <ChevronRight className="w-4 h-4 text-mc-text-secondary" />}
            <ListTodo className="w-4 h-4 text-mc-accent-cyan" />
            <h2 className="text-sm font-semibold text-mc-text">Standalone Tasks</h2>
            {items && items.length > 0 && (
              <span className="text-xs text-mc-text-secondary tabular-nums">({items.length})</span>
            )}
          </div>
          <div onClick={e => e.stopPropagation()} className="flex items-center gap-1">
            <Link
              href={`/workspace/${workspaceSlug}/standalone`}
              className="flex items-center gap-1 px-2 py-1 rounded border border-mc-border text-mc-text-secondary text-xs hover:text-mc-text hover:bg-mc-bg-tertiary"
              title="Open these tasks in a kanban board"
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Open as Kanban
            </Link>
            <button
              onClick={load}
              className="p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-mc-accent/10 border border-mc-accent/40 text-mc-accent text-xs font-medium hover:bg-mc-accent/20"
            >
              <Plus className="w-3.5 h-3.5" /> New task
            </button>
          </div>
        </button>

        {open && (
          <div className="px-4 pb-4">
            <p className="text-[11px] text-mc-text-secondary mb-3">
              Tasks not attached to any mission. Use <strong>Add to mission ▼</strong> to fold one into a running mission so agents pick it up.
            </p>

            {error && (
              <div className="flex items-start gap-2 text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded px-2 py-1.5 mb-3">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
              </div>
            )}

            {!items && (
              <div className="flex items-center gap-2 text-sm text-mc-text-secondary py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            )}

            {items && items.length === 0 && (
              <div className="text-center text-xs text-mc-text-secondary py-6 border border-dashed border-mc-border rounded-lg">
                No standalone tasks. Create one with the button above, or via the chat slash command <code>/task &quot;your title&quot;</code>.
              </div>
            )}

            {items && items.length > 0 && (
              <ul className="space-y-2">
                {items.map(t => (
                  <li key={t.id} className="flex items-start gap-3 p-3 rounded-lg border border-mc-border bg-mc-bg">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${STATUS_BADGE[t.status] ?? STATUS_BADGE.inbox}`}>
                          {t.status.replace('_', ' ')}
                        </span>
                        <h3 className="text-sm text-mc-text truncate">{t.title}</h3>
                        {t.assigned_agent_name && (
                          <span className="text-[10px] text-mc-text-secondary">
                            {t.assigned_agent_emoji ?? '🤖'} {t.assigned_agent_name}
                          </span>
                        )}
                      </div>
                      {t.description && (
                        <p className="text-[11px] text-mc-text-secondary mt-1 line-clamp-2">{t.description}</p>
                      )}
                      <p className="text-[10px] text-mc-text-secondary mt-1">
                        Created {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
                      </p>

                      {/* Adopt picker */}
                      {adoptingId === t.id && (
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          {activeMissions.length === 0 ? (
                            <span className="text-[11px] text-mc-text-secondary italic">No active missions to adopt into.</span>
                          ) : (
                            <>
                              <span className="text-[11px] text-mc-text-secondary">Add to:</span>
                              {activeMissions.map(m => (
                                <button
                                  key={m.id}
                                  onClick={() => adopt(t.id, m.id)}
                                  disabled={busyId === t.id}
                                  className="text-[11px] px-2 py-0.5 rounded border border-mc-accent/40 text-mc-accent bg-mc-accent/5 hover:bg-mc-accent/15 disabled:opacity-50"
                                  title={`Mission stage: ${m.mission_stage}`}
                                >
                                  🎯 {m.name.slice(0, 50)}
                                </button>
                              ))}
                            </>
                          )}
                          <button
                            onClick={() => setAdoptingId(null)}
                            className="text-[11px] px-2 py-0.5 rounded text-mc-text-secondary hover:text-mc-text"
                          >
                            cancel
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setAdoptingId(adoptingId === t.id ? null : t.id)}
                        disabled={busyId === t.id || activeMissions.length === 0}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-mc-accent-cyan/10 text-mc-accent-cyan border border-mc-accent-cyan/40 text-[11px] hover:bg-mc-accent-cyan/20 disabled:opacity-40"
                        title={activeMissions.length === 0 ? 'No active missions' : 'Adopt into a mission'}
                      >
                        <Target className="w-3 h-3" /> Add to mission
                      </button>
                      <button
                        onClick={() => setEditingId(t.id)}
                        disabled={busyId === t.id}
                        className="p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary"
                        title="Edit"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => remove(t)}
                        disabled={busyId === t.id}
                        className="p-1.5 rounded hover:bg-mc-accent-red/10 text-mc-accent-red"
                        title="Delete"
                      >
                        {busyId === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {showCreate && (
        <TaskModal
          workspaceId={workspaceId}
          onClose={() => { setShowCreate(false); load(); }}
        />
      )}
      {editingTask && (
        <TaskModal
          task={editingTask as unknown as Parameters<typeof TaskModal>[0]['task']}
          workspaceId={workspaceId}
          onClose={() => { setEditingId(null); load(); }}
        />
      )}
    </>
  );
}
