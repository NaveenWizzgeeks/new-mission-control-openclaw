'use client';

import { useEffect, useState } from 'react';
import { Plus, ChevronRight, GripVertical, ArrowRightLeft, AlertTriangle, MessageSquare, RefreshCw, Loader2 } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { useConfirm } from '@/components/ConfirmDialog';
import { triggerAutoDispatch, shouldTriggerAutoDispatch } from '@/lib/auto-dispatch';
import { getConfig } from '@/lib/config';
import { useUnreadCounts } from '@/hooks/useUnreadCounts';
import type { Task, TaskStatus } from '@/lib/types';
import { TaskModal } from './TaskModal';
import { formatDistanceToNow } from 'date-fns';

interface MissionQueueProps {
  workspaceId?: string;
  /** When provided, scopes the task list to subtasks of this convoy (mission drilldown). */
  convoyId?: string;
  mobileMode?: boolean;
  isPortrait?: boolean;
  /** Phase 13P.3: when true (and convoyId is not set), filter to standalone tasks
   *  in the workspace — exclude subtasks AND mission-parent tasks (those are
   *  the missions themselves, not workable tasks). Caller passes the parent
   *  ids via excludeIds so we don't need to query convoys client-side. */
  standaloneOnly?: boolean;
  excludeIds?: string[];
}

// Phase 13S.1: 'rejected' is a virtual column — it doesn't map to a real
// status value. We render tasks with rejected_at IS NOT NULL here regardless
// of their underlying status. Keeping it as the last column so the active
// pipeline stays visually compact.
const REJECTED_COLUMN_ID = '__rejected__' as const;

const COLUMNS: { id: TaskStatus | typeof REJECTED_COLUMN_ID; label: string; color: string }[] = [
  { id: 'planner_proposed', label: '✨ Proposed', color: 'border-t-mc-accent-purple' },
  { id: 'planning', label: '📋 Planning', color: 'border-t-mc-accent-purple' },
  { id: 'inbox', label: 'Inbox', color: 'border-t-mc-accent-pink' },
  { id: 'assigned', label: 'Assigned', color: 'border-t-mc-accent-yellow' },
  { id: 'in_progress', label: 'In Progress', color: 'border-t-mc-accent' },
  { id: 'convoy_active', label: '🚚 Convoy', color: 'border-t-cyan-400' },
  { id: 'testing', label: 'Testing', color: 'border-t-mc-accent-cyan' },
  { id: 'review', label: 'Review', color: 'border-t-mc-accent-purple' },
  { id: 'verification', label: 'Verification', color: 'border-t-orange-500' },
  { id: 'done', label: 'Done', color: 'border-t-mc-accent-green' },
  { id: REJECTED_COLUMN_ID, label: '🗑 Rejected', color: 'border-t-mc-text-secondary' },
];

export function MissionQueue({ workspaceId, convoyId, mobileMode = false, isPortrait = true, standaloneOnly = false, excludeIds }: MissionQueueProps) {
  const { tasks, updateTaskStatus, addEvent, setTasks } = useMissionControl();
  const confirmModal = useConfirm();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/tasks');
      if (res.ok) setTasks(await res.json());
    } finally {
      setRefreshing(false);
    }
  };
  const [compactEmptyColumns, setCompactEmptyColumns] = useState(true);
  const unreadCounts = useUnreadCounts();

  useEffect(() => {
    const cfg = getConfig();
    setCompactEmptyColumns(cfg.kanbanCompactEmptyColumns ?? true);
  }, []);

  const getDesktopColumnWidth = (taskCount: number): string => {
    if (!compactEmptyColumns) return '280px';
    if (taskCount === 0) return 'fit-content';
    // Slightly grow busy columns while keeping a sane cap
    const widthPx = Math.min(380, 250 + taskCount * 14);
    return `${widthPx}px`;
  };
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>('planning');
  const [statusMoveTask, setStatusMoveTask] = useState<Task | null>(null);
  const [pendingMove, setPendingMove] = useState<{ task: Task; targetStatus: TaskStatus } | null>(null);

  // When convoyId is provided (drilldown mode), show only subtasks of that convoy.
  // standaloneOnly + workspaceId → standalone tasks (no convoy, not a subtask, not a mission parent).
  // workspaceId alone → all non-subtasks in the workspace (legacy).
  const excludeSet = excludeIds && excludeIds.length > 0 ? new Set(excludeIds) : null;
  const visibleTasks = convoyId
    ? tasks.filter(t => t.convoy_id === convoyId && t.is_subtask)
    : standaloneOnly && workspaceId
      ? tasks.filter(t =>
          t.workspace_id === workspaceId
          && !t.is_subtask
          && !t.convoy_id
          && (!excludeSet || !excludeSet.has(t.id))
        )
      : workspaceId
        ? tasks.filter(t => t.workspace_id === workspaceId && !t.is_subtask)
        : tasks.filter(t => !t.is_subtask);

  // Phase 13S.1: rejected tasks live in their own virtual column so they don't
  // pollute the active pipeline. All other columns must EXCLUDE rejected.
  const getTasksByStatus = (status: TaskStatus | typeof REJECTED_COLUMN_ID) => {
    if (status === REJECTED_COLUMN_ID) {
      return visibleTasks.filter((task) => !!(task as Task & { rejected_at?: string | null }).rejected_at);
    }
    return visibleTasks.filter((task) =>
      task.status === status && !(task as Task & { rejected_at?: string | null }).rejected_at
    );
  };

  // Active pipeline states where manual moves are dangerous
  const ACTIVE_PIPELINE_STATES: TaskStatus[] = ['assigned', 'in_progress', 'convoy_active', 'testing', 'review', 'verification'];

  const getPipelineWarning = (task: Task, targetStatus: TaskStatus): string | null => {
    if (!ACTIVE_PIPELINE_STATES.includes(task.status)) return null;
    // Moving to the same status or to done is less dangerous
    if (task.status === targetStatus) return null;

    const stateLabels: Record<string, string> = {
      assigned: 'queued for dispatch',
      in_progress: 'being built by an agent',
      convoy_active: 'running as a convoy',
      testing: 'being tested by an agent',
      review: 'in the review queue',
      verification: 'being verified by an agent',
    };

    const current = stateLabels[task.status] || task.status;
    return `This task is currently ${current}. Moving it manually will interrupt the automation pipeline and may cause the assigned agent to lose context. Are you sure you want to override?`;
  };

  const attemptMove = async (task: Task, targetStatus: TaskStatus) => {
    const warning = getPipelineWarning(task, targetStatus);
    if (warning) {
      setPendingMove({ task, targetStatus });
      return;
    }
    await updateTaskStatusWithPersist(task, targetStatus);
  };

  const confirmPendingMove = async () => {
    if (!pendingMove) return;
    const { task, targetStatus } = pendingMove;
    setPendingMove(null);
    setStatusMoveTask(null);
    await updateTaskStatusWithPersist(task, targetStatus);
  };

  // Approve a planner-proposed task → moves it to inbox so the existing dispatch flow picks it up.
  const handleApproveProposed = async (task: Task) => {
    await updateTaskStatusWithPersist(task, 'inbox');
  };

  // Reject a planner-proposed task → DELETEs it. Frontend store stays consistent because
  // the SSE poll / next refresh will drop it; we also strip it locally for snappy UX.
  const handleRejectProposed = async (task: Task) => {
    if (!await confirmModal({
      title: `Reject proposed task "${task.title}"?`,
      body: 'It moves to the Rejected column. Fury won\'t re-propose it. You can restore later if needed.',
      confirmLabel: 'Reject',
      danger: true,
    })) return;
    try {
      // Phase 13S.1: reject (don't delete). Sets rejected_at; stays in DB.
      const res = await fetch(`/api/tasks/${task.id}/reject`, { method: 'POST' });
      if (res.ok) {
        // Refresh from server so the local task carries rejected_at and slots
        // into the Rejected column on next render.
        await refresh();
      }
    } catch (err) {
      console.error('[MissionQueue] reject proposed failed:', err);
    }
  };

  // Phase 13S.1: restore a rejected task back to inbox (or proposed).
  const handleRestoreRejected = async (task: Task, target: 'inbox' | 'planner_proposed' = 'inbox') => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: target }),
      });
      if (res.ok) await refresh();
    } catch (err) {
      console.error('[MissionQueue] restore rejected failed:', err);
    }
  };

  const handleApproveAllProposed = async () => {
    const proposed = visibleTasks.filter(t => t.status === 'planner_proposed');
    if (proposed.length === 0) return;
    if (!await confirmModal({
      title: `Approve all ${proposed.length} proposed task${proposed.length === 1 ? '' : 's'}?`,
      body: 'They\'ll move to inbox and start dispatching according to dependencies.',
      confirmLabel: `Approve all ${proposed.length}`,
    })) return;
    for (const t of proposed) {
      // Sequential to keep auto-dispatch ordering predictable.
      // eslint-disable-next-line no-await-in-loop
      await updateTaskStatusWithPersist(t, 'inbox');
    }
  };

  const updateTaskStatusWithPersist = async (task: Task, targetStatus: TaskStatus) => {
    if (task.status === targetStatus) return;

    updateTaskStatus(task.id, targetStatus);

    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus }),
      });

      if (res.ok) {
        addEvent({
          id: task.id + '-' + Date.now(),
          type: targetStatus === 'done' ? 'task_completed' : 'task_status_changed',
          task_id: task.id,
          message: `Task "${task.title}" moved to ${targetStatus}`,
          created_at: new Date().toISOString(),
        });

        if (shouldTriggerAutoDispatch(task.status, targetStatus, task.assigned_agent_id)) {
          const result = await triggerAutoDispatch({
            taskId: task.id,
            taskTitle: task.title,
            agentId: task.assigned_agent_id,
            agentName: task.assigned_agent?.name || 'Unknown Agent',
            workspaceId: task.workspace_id,
          });

          if (!result.success) {
            console.error('Auto-dispatch failed:', result.error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to update task status:', error);
      updateTaskStatus(task.id, task.status);
    }
  };

  const handleDragStart = (e: React.DragEvent, task: Task) => {
    if (mobileMode) return;
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (mobileMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: TaskStatus) => {
    if (mobileMode) return;
    e.preventDefault();
    if (!draggedTask || draggedTask.status === targetStatus) {
      setDraggedTask(null);
      return;
    }

    await attemptMove(draggedTask, targetStatus);
    setDraggedTask(null);
  };

  const mobileTasks = getTasksByStatus(mobileStatus);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-mc-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChevronRight className="w-4 h-4 text-mc-text-secondary" />
          <span className="text-sm font-medium uppercase tracking-wider">Mission Queue</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-2.5 min-h-11 rounded border border-mc-border bg-mc-bg text-xs text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary disabled:opacity-50"
            title="Re-fetch tasks from the server"
          >
            {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 min-h-11 bg-mc-accent-blue text-mc-bg rounded text-sm font-medium hover:bg-mc-accent-blue/90"
          >
            <Plus className="w-4 h-4" />
            New Task
          </button>
        </div>
      </div>

      {!mobileMode ? (
        <div className="mission-queue-scroll-x flex-1 flex gap-3 p-3 overflow-x-auto">
          {COLUMNS.map((column) => {
            const columnTasks = getTasksByStatus(column.id);
            const hasTasks = columnTasks.length > 0;
            return (
              <div
                key={column.id}
                style={{ width: getDesktopColumnWidth(columnTasks.length) }}
                className={`flex-none ${compactEmptyColumns ? (hasTasks ? 'min-w-[240px]' : 'min-w-[110px] max-w-[180px]') : 'min-w-[250px] max-w-[320px]'} flex flex-col bg-mc-bg rounded-lg border border-mc-border/50 border-t-2 transition-[width] duration-200 ${column.color}`}
                onDragOver={column.id === REJECTED_COLUMN_ID ? undefined : handleDragOver}
                onDrop={column.id === REJECTED_COLUMN_ID ? undefined : (e) => handleDrop(e, column.id as TaskStatus)}
              >
                <div className="p-2 border-b border-mc-border flex items-center justify-between gap-2">
                  <span className="text-xs font-medium uppercase text-mc-text-secondary whitespace-nowrap">{column.label}</span>
                  <div className="flex items-center gap-1">
                    {column.id === 'planner_proposed' && hasTasks && (
                      <button
                        onClick={handleApproveAllProposed}
                        className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-mc-accent-purple/20 text-mc-accent-purple hover:bg-mc-accent-purple/30"
                        title="Approve all proposed tasks"
                      >
                        Approve all
                      </button>
                    )}
                    <span className="text-xs bg-mc-bg-tertiary px-2 py-0.5 rounded text-mc-text-secondary">{columnTasks.length}</span>
                  </div>
                </div>

                <div className={`flex-1 overflow-y-auto p-2 ${hasTasks ? 'space-y-2' : ''}`}>
                  {columnTasks.map((task) => {
                    const isRejected = !!(task as Task & { rejected_at?: string | null }).rejected_at;
                    return (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onDragStart={handleDragStart}
                        onClick={() => setEditingTask(task)}
                        onMoveStatus={() => setStatusMoveTask(task)}
                        onApprove={!isRejected && task.status === 'planner_proposed' ? () => handleApproveProposed(task) : undefined}
                        onReject={!isRejected && task.status === 'planner_proposed' ? () => handleRejectProposed(task) : undefined}
                        onRestore={isRejected ? (target) => handleRestoreRejected(task, target) : undefined}
                        isDragging={draggedTask?.id === task.id}
                        mobileMode={false}
                        portraitMode={false}
                        unreadCount={unreadCounts[task.id] || 0}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={`flex-1 overflow-y-auto ${isPortrait ? 'p-3 pb-[calc(1rem+env(safe-area-inset-bottom))]' : 'p-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))]'}`}>
          <div className={`flex gap-2 overflow-x-auto ${isPortrait ? 'pb-3' : 'pb-2'}`}>
            {COLUMNS.map((column) => {
              const count = getTasksByStatus(column.id).length;
              const selected = mobileStatus === column.id;
              return (
                <button
                  key={column.id}
                  onClick={() => column.id !== REJECTED_COLUMN_ID && setMobileStatus(column.id)}
                  className={`min-h-11 px-4 rounded-full border whitespace-nowrap ${isPortrait ? 'text-sm' : 'text-xs'} ${
                    selected
                      ? 'bg-mc-accent text-mc-bg border-mc-accent font-medium'
                      : 'bg-mc-bg-secondary border-mc-border text-mc-text-secondary'
                  }`}
                >
                  {column.label} ({count})
                </button>
              );
            })}
          </div>

          <div className={`min-w-0 ${isPortrait ? 'space-y-3' : 'space-y-2'}`}>
            {mobileTasks.length === 0 ? (
              <div className="text-sm text-mc-text-secondary bg-mc-bg-secondary border border-mc-border rounded-lg p-4">
                No tasks in this status.
              </div>
            ) : (
              mobileTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onDragStart={handleDragStart}
                  onClick={() => setEditingTask(task)}
                  onMoveStatus={() => setStatusMoveTask(task)}
                  onApprove={!(task as Task & { rejected_at?: string | null }).rejected_at && task.status === 'planner_proposed' ? () => handleApproveProposed(task) : undefined}
                  onReject={!(task as Task & { rejected_at?: string | null }).rejected_at && task.status === 'planner_proposed' ? () => handleRejectProposed(task) : undefined}
                  onRestore={(task as Task & { rejected_at?: string | null }).rejected_at ? (target) => handleRestoreRejected(task, target) : undefined}
                  isDragging={false}
                  mobileMode
                  portraitMode={isPortrait}
                  unreadCount={unreadCounts[task.id] || 0}
                />
              ))
            )}
          </div>
        </div>
      )}

      {showCreateModal && <TaskModal onClose={() => setShowCreateModal(false)} workspaceId={workspaceId} convoyId={convoyId} />}
      {editingTask && <TaskModal task={editingTask} onClose={() => setEditingTask(null)} workspaceId={workspaceId} />}

      {mobileMode && statusMoveTask && (
        <div className="fixed inset-0 z-50 bg-black/60 p-4 flex items-end sm:items-center sm:justify-center" onClick={() => setStatusMoveTask(null)}>
          <div
            className="w-full sm:max-w-md bg-mc-bg-secondary border border-mc-border rounded-t-xl sm:rounded-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm text-mc-text-secondary mb-2">Move task</div>
            <div className="font-medium mb-4 line-clamp-2">{statusMoveTask.title}</div>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {COLUMNS.filter(c => c.id !== REJECTED_COLUMN_ID).map((column) => (
                <button
                  key={column.id}
                  onClick={async () => {
                    await attemptMove(statusMoveTask, column.id as TaskStatus);
                    if (!getPipelineWarning(statusMoveTask, column.id as TaskStatus)) {
                      setStatusMoveTask(null);
                    }
                  }}
                  disabled={statusMoveTask.status === column.id}
                  className="w-full min-h-11 px-4 rounded-lg border border-mc-border bg-mc-bg text-left text-sm disabled:opacity-40"
                >
                  {column.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Pipeline override warning dialog */}
      {pendingMove && (
        <div className="fixed inset-0 z-[60] bg-black/60 p-4 flex items-center justify-center" onClick={() => setPendingMove(null)}>
          <div
            className="w-full max-w-md bg-mc-bg-secondary border border-amber-500/30 rounded-xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-mc-text">Override automation?</h3>
                <p className="text-sm text-mc-text-secondary mt-1">
                  {getPipelineWarning(pendingMove.task, pendingMove.targetStatus)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 bg-mc-bg rounded-lg border border-mc-border text-sm">
              <span className="text-mc-text-secondary">Moving:</span>
              <span className="font-medium text-mc-text truncate">{pendingMove.task.title}</span>
              <span className="text-mc-text-secondary mx-1">&rarr;</span>
              <span className="font-medium text-mc-text">{COLUMNS.find(c => c.id === pendingMove.targetStatus)?.label || pendingMove.targetStatus}</span>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingMove(null)}
                className="min-h-11 px-4 rounded-lg text-sm text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary"
              >
                Cancel
              </button>
              <button
                onClick={confirmPendingMove}
                className="min-h-11 px-4 rounded-lg text-sm font-medium bg-amber-500 text-black hover:bg-amber-400"
              >
                Override &amp; Move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AssignedStatusBadge({ task, portraitMode }: { task: Task; portraitMode: boolean }) {
  const [retrying, setRetrying] = useState(false);
  const updatedAt = new Date(task.updated_at).getTime();
  const staleMs = Date.now() - updatedAt;
  const isStale = staleMs > 2 * 60 * 1000; // 2 minutes

  const handleRetryDispatch = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't open the task modal
    setRetrying(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/dispatch`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error('Retry dispatch failed:', data.error);
      }
    } catch (err) {
      console.error('Retry dispatch error:', err);
    } finally {
      setRetrying(false);
    }
  };

  if (isStale) {
    const staleMinutes = Math.floor(staleMs / 60000);
    return (
      <div className={`${portraitMode ? 'mb-3 py-2 px-3' : 'mb-2 py-1.5 px-2.5'} bg-amber-500/10 rounded-md border border-amber-500/30`}>
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-2 h-2 bg-amber-400 rounded-full flex-shrink-0" />
          <span className="text-xs text-amber-200">Stuck in assigned for {staleMinutes}m</span>
        </div>
        <button
          onClick={handleRetryDispatch}
          disabled={retrying}
          className="text-[11px] px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded border border-amber-500/30 disabled:opacity-50"
        >
          {retrying ? 'Dispatching...' : '↻ Retry Dispatch'}
        </button>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${portraitMode ? 'mb-3 py-2 px-3' : 'mb-2 py-1.5 px-2.5'} bg-yellow-500/10 rounded-md border border-yellow-500/30`}>
      <div className="w-2 h-2 bg-yellow-400 rounded-full flex-shrink-0" />
      <span className="text-xs text-yellow-200">Assigned and validating — auto-start will move this to In Progress.</span>
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  onDragStart: (e: React.DragEvent, task: Task) => void;
  onClick: () => void;
  onMoveStatus: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  /** Phase 13S.1: shown for tasks in the Rejected column. */
  onRestore?: (target: 'inbox' | 'planner_proposed') => void;
  isDragging: boolean;
  mobileMode: boolean;
  portraitMode?: boolean;
  unreadCount?: number;
}

function TaskCard({ task, onDragStart, onClick, onMoveStatus, onApprove, onReject, onRestore, isDragging, mobileMode, portraitMode = true, unreadCount = 0 }: TaskCardProps) {
  const priorityStyles = {
    low: 'text-mc-text-secondary',
    normal: 'text-mc-accent',
    high: 'text-mc-accent-yellow',
    urgent: 'text-mc-accent-red',
  };

  const priorityDots = {
    low: 'bg-mc-text-secondary/40',
    normal: 'bg-mc-accent',
    high: 'bg-mc-accent-yellow',
    urgent: 'bg-mc-accent-red',
  };

  const isPlanning = task.status === 'planning';
  const isConvoyActive = task.status === 'convoy_active';
  const isSubtask = !!task.is_subtask;
  const isAssigned = task.status === 'assigned';
  const dispatchError = task.planning_dispatch_error;
  // Phase 13S.12: messages prefixed with ⏳ are soft notices ("taking longer
  // than usual"), rendered amber. Real errors stay red.
  const isSoftNotice = !!dispatchError && dispatchError.startsWith('⏳ ');
  const noticeClasses = isSoftNotice
    ? { wrap: 'bg-amber-500/10 border border-amber-500/30', dot: 'bg-amber-400', text: 'text-amber-200' }
    : { wrap: 'bg-red-500/10 border border-red-500/30', dot: 'bg-red-400', text: 'text-red-300' };

  return (
    <div
      draggable={!mobileMode}
      onDragStart={(e) => onDragStart(e, task)}
      onClick={onClick}
      className={`group bg-mc-bg-secondary border rounded-lg cursor-pointer transition-all hover:shadow-lg hover:shadow-black/20 ${
        isDragging ? 'opacity-50 scale-95' : ''
      } ${isPlanning ? 'border-purple-500/40 hover:border-purple-500' : 'border-mc-border/50 hover:border-mc-accent/40'}`}
    >
      {!mobileMode && (
        <div className="flex items-center justify-center py-1.5 border-b border-mc-border/30 opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical className="w-4 h-4 text-mc-text-secondary/50 cursor-grab" />
        </div>
      )}

      <div className={portraitMode ? 'p-4' : 'p-3'}>
        <div className="flex items-start justify-between gap-1.5">
          <h4 className={`font-medium leading-snug line-clamp-2 ${portraitMode ? 'text-sm mb-3' : 'text-xs mb-2'}`}>{task.title}</h4>
          {unreadCount > 0 && (
            <span className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 bg-mc-accent/15 text-mc-accent rounded text-[10px] font-medium" title={`${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}`}>
              <MessageSquare className="w-2.5 h-2.5" />
              {unreadCount}
            </span>
          )}
        </div>

        {task.status === 'planner_proposed' && (
          <div className={`${portraitMode ? 'mb-3 py-2 px-3' : 'mb-2 py-1.5 px-2.5'} bg-mc-accent-purple/10 rounded-md border border-mc-accent-purple/30`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-mc-accent-purple/20 text-mc-accent-purple font-medium">
                AI Proposed
              </span>
              <span className="text-[10px] text-mc-text-secondary">by Fury</span>
            </div>
            {(onApprove || onReject) && (
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                {onApprove && (
                  <button
                    onClick={onApprove}
                    className="flex-1 text-[11px] px-2 py-1 rounded bg-mc-accent-green/15 text-mc-accent-green hover:bg-mc-accent-green/25 font-medium"
                  >
                    ✓ Approve
                  </button>
                )}
                {onReject && (
                  <button
                    onClick={onReject}
                    className="flex-1 text-[11px] px-2 py-1 rounded bg-mc-accent-red/15 text-mc-accent-red hover:bg-mc-accent-red/25 font-medium"
                  >
                    ✗ Reject
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Phase 13S.1: rejected card — show muted state + Restore action */}
        {(task as Task & { rejected_at?: string | null }).rejected_at && onRestore && (
          <div className={`${portraitMode ? 'mb-3 py-2 px-3' : 'mb-2 py-1.5 px-2.5'} bg-mc-bg-tertiary rounded-md border border-mc-border opacity-90`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wider text-mc-text-secondary">Rejected</span>
              <span className="text-[10px] text-mc-text-secondary opacity-70">
                {new Date((task as Task & { rejected_at?: string | null }).rejected_at!).toLocaleDateString()}
              </span>
            </div>
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => onRestore('inbox')}
                className="flex-1 text-[11px] px-2 py-1 rounded bg-mc-accent/10 text-mc-accent border border-mc-accent/40 hover:bg-mc-accent/20 font-medium"
                title="Restore and queue for execution"
              >
                ↺ Move to Inbox
              </button>
              <button
                onClick={() => onRestore('planner_proposed')}
                className="flex-1 text-[11px] px-2 py-1 rounded bg-mc-accent-purple/10 text-mc-accent-purple border border-mc-accent-purple/40 hover:bg-mc-accent-purple/20 font-medium"
                title="Put back in Proposed for re-decision"
              >
                ✨ Re-propose
              </button>
            </div>
          </div>
        )}

        {isPlanning && (
          <div className={`${portraitMode ? 'mb-3 py-2 px-3' : 'mb-2 py-1.5 px-2.5'} bg-purple-500/10 rounded-md border border-purple-500/20`}>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse flex-shrink-0" />
              <span className="text-xs text-purple-400 font-medium">
                {isSubtask ? 'Awaiting plan' : 'Continue planning'}
              </span>
            </div>
            {isSubtask && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await fetch(`/api/tasks/${task.id}/skip-planning`, { method: 'POST' });
                  } catch (err) {
                    console.error('[skip-planning] request failed:', err);
                  }
                }}
                className="w-full text-[11px] px-2 py-1 rounded bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 font-medium"
              >
                Skip planning → start now
              </button>
            )}
          </div>
        )}

        {isConvoyActive && (
          <div className={`flex items-center gap-2 ${portraitMode ? 'mb-3 py-2 px-3' : 'mb-2 py-1.5 px-2.5'} bg-cyan-500/10 rounded-md border border-cyan-500/20`}>
            <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse flex-shrink-0" />
            <span className="text-xs text-cyan-300 font-medium">Convoy active — sub-tasks running</span>
          </div>
        )}

        {/* Phase 13O: stuck-task recovery controls. Show on subtasks that are
            in_progress/assigned and haven't moved in 10+ minutes.
            Phase 13X: when the agent has logged a 'completed' activity recently
            but status hasn't moved yet, the auto-promote scheduler is about to
            advance it — show a non-actionable "Reconciling…" pill instead so
            users don't fire a redundant manual re-dispatch. */}
        {isSubtask && (task.status === 'in_progress' || task.status === 'assigned') && minutesSince(task.updated_at) >= 10 && (
          isPendingReconcile(task) ? (
            <div className={`flex items-center gap-2 ${portraitMode ? 'mb-3 py-2 px-3' : 'mb-2 py-1.5 px-2.5'} bg-cyan-500/10 rounded-md border border-cyan-500/20`}>
              <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse flex-shrink-0" />
              <span className="text-xs text-cyan-300">Reconciling — agent reported done, advancing the task…</span>
            </div>
          ) : (
            <StuckTaskControls
              taskId={task.id}
              minutes={minutesSince(task.updated_at)}
              portraitMode={portraitMode}
            />
          )
        )}

        {isSubtask && (
          <div className={`flex items-center gap-1 ${portraitMode ? 'mb-2' : 'mb-1.5'}`}>
            <span className="text-[10px] px-1.5 py-0.5 bg-cyan-500/15 text-cyan-400 rounded border border-cyan-500/20">SUB-TASK</span>
          </div>
        )}

        {isAssigned && dispatchError && (
          <div className={`flex items-start gap-2 ${portraitMode ? 'mb-3 py-2 px-3' : 'mb-2 py-1.5 px-2.5'} ${noticeClasses.wrap} rounded-md`}>
            <div className={`w-2 h-2 ${noticeClasses.dot} rounded-full mt-1 flex-shrink-0`} />
            <span className={`text-xs ${noticeClasses.text}`}>{isSoftNotice ? dispatchError : `Assigned, but blocked: ${dispatchError}`}</span>
          </div>
        )}

        {isAssigned && !dispatchError && (
          <AssignedStatusBadge task={task} portraitMode={portraitMode} />
        )}

        {task.status === 'inbox' && !task.assigned_agent_id && (
          <div className={`flex items-center gap-2 ${portraitMode ? 'mb-3 py-2 px-3' : 'mb-2 py-1.5 px-2.5'} bg-amber-500/10 rounded-md border border-amber-500/30`}>
            <div className="w-2 h-2 bg-amber-400 rounded-full flex-shrink-0" />
            <span className="text-xs text-amber-200">Needs agent — assign to start</span>
          </div>
        )}

        {['testing', 'verification', 'in_progress', 'review'].includes(task.status) && dispatchError && (
          <div className={`flex items-start gap-2 ${portraitMode ? 'mb-3 py-2 px-3' : 'mb-2 py-1.5 px-2.5'} ${noticeClasses.wrap} rounded-md`}>
            <div className={`w-2 h-2 ${noticeClasses.dot} rounded-full mt-1 flex-shrink-0`} />
            <span className={`text-xs ${noticeClasses.text}`}>{dispatchError}</span>
          </div>
        )}

        {task.status === 'review' && !dispatchError && (
          <div className={`flex items-center gap-2 ${portraitMode ? 'mb-3 py-2 px-3' : 'mb-2 py-1.5 px-2.5'} bg-cyan-500/10 rounded-md border border-cyan-500/30`}>
            <div className="w-2 h-2 bg-cyan-400 rounded-full flex-shrink-0" />
            <span className="text-xs text-cyan-200">In queue — waiting for verification</span>
          </div>
        )}

        {task.assigned_agent && (
          <div className={`flex items-center gap-2 ${portraitMode ? 'mb-3 py-1.5 px-2' : 'mb-2 py-1 px-2'} bg-mc-bg-tertiary/50 rounded`}>
            <span className="text-base">{(task.assigned_agent as unknown as { avatar_emoji: string }).avatar_emoji}</span>
            <span className="text-xs text-mc-text-secondary truncate">{(task.assigned_agent as unknown as { name: string }).name}</span>
          </div>
        )}

        {task.workspace_path && (
          <div className={`flex items-center gap-1.5 ${portraitMode ? 'mb-2' : 'mb-1.5'}`}>
            <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/15 text-purple-400 rounded border border-purple-500/20">
              {task.workspace_strategy === 'worktree' ? '\u{1F500}' : '\u{1F512}'} ISOLATED
            </span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-mc-border/20">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${priorityDots[task.priority]}`} />
            <span className={`text-xs capitalize ${priorityStyles[task.priority]}`}>{task.priority}</span>
          </div>
          <span className="text-[10px] text-mc-text-secondary/60">{formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}</span>
        </div>

        {mobileMode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMoveStatus();
            }}
            className={`w-full min-h-11 rounded-md border border-mc-border bg-mc-bg flex items-center justify-center gap-2 text-mc-text-secondary ${portraitMode ? 'mt-3 text-sm' : 'mt-2 text-xs'}`}
          >
            <ArrowRightLeft className="w-4 h-4" />
            Move Status
          </button>
        )}
      </div>
    </div>
  );
}

function minutesSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60_000));
}

/**
 * True when the task has a recent 'completed' activity (within the
 * auto-promote window) but status hasn't advanced yet. The watchdog or the
 * scheduled auto-promote will move it within seconds, so the UI hides the
 * stuck-task controls and shows a benign "Reconciling…" pill instead.
 */
function isPendingReconcile(task: Task): boolean {
  if (!task.last_completed_activity_at) return false;
  const completedAt = new Date(task.last_completed_activity_at).getTime();
  if (!Number.isFinite(completedAt)) return false;
  const minsSince = (Date.now() - completedAt) / 60_000;
  // Window matches RECENT_COMPLETION_WINDOW_MIN in agent-health.ts
  return minsSince <= 30;
}

/** Phase 13O: per-subtask sync-from-gateway + redispatch controls. */
function StuckTaskControls({
  taskId,
  minutes,
  portraitMode,
}: { taskId: string; minutes: number; portraitMode: boolean }) {
  const [busy, setBusy] = useState<'sync' | 'redispatch' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const confirmModal = useConfirm();

  const sync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy('sync');
    setResult(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/sync-from-gateway`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult(`Sync failed: ${data.error || res.status}`);
      } else if (data.action === 'marked_done') {
        setResult('✓ Marked done from gateway. Next subtask will dispatch.');
      } else if (data.action === 'flagged_failed') {
        setResult(`Gateway session failed (${data.session?.status}). Click Re-dispatch.`);
      } else {
        setResult(data.reason || 'No change — gateway session still running.');
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Sync error');
    } finally {
      setBusy(null);
    }
  };

  const redispatch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!await confirmModal({
      title: 'Re-dispatch this task?',
      body: 'Agent will start fresh with the full mission-progress context. Already-completed work on disk is preserved — they\'ll see what\'s done and continue.',
      confirmLabel: 'Re-dispatch',
    })) return;
    setBusy('redispatch');
    setResult(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/redispatch`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult(`Re-dispatch failed: ${data.error || res.status}`);
      } else {
        setResult('✓ Re-dispatched. Watch the chat tab for progress.');
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Re-dispatch error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`${portraitMode ? 'mb-3 py-2 px-3' : 'mb-2 py-1.5 px-2.5'} bg-amber-500/10 rounded-md border border-amber-500/30 space-y-1.5`}
    >
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse flex-shrink-0" />
        <span className="text-xs text-amber-200 font-medium">
          Idle for {minutes}m — agent may be done or stuck
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={sync}
          disabled={busy !== null}
          className="flex-1 flex items-center justify-center gap-1 text-[11px] px-2 py-1 rounded bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
          title="Check gateway session status; if done, mark this task done"
        >
          {busy === 'sync' ? '⏳' : '🔄'} Sync from gateway
        </button>
        <button
          onClick={redispatch}
          disabled={busy !== null}
          className="flex-1 flex items-center justify-center gap-1 text-[11px] px-2 py-1 rounded bg-mc-accent/15 text-mc-accent hover:bg-mc-accent/25 disabled:opacity-50"
          title="Reset to assigned and re-dispatch a fresh agent run"
        >
          {busy === 'redispatch' ? '⏳' : '↻'} Re-dispatch
        </button>
      </div>
      {result && (
        <p className="text-[11px] text-mc-text-secondary">{result}</p>
      )}
    </div>
  );
}
