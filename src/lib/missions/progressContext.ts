/**
 * Mission progress context builder (Phase 13L Fix 3).
 *
 * Returns a Markdown block summarizing where the mission stands so the agent
 * about to be dispatched knows:
 *   - what the canonical project path is
 *   - what previous subtasks already produced (titles + a one-line note)
 *   - what's running in parallel right now
 *   - what's queued after this one
 *
 * Goal: eliminate duplicate work across agents. Agent #4 should NOT re-create
 * a folder that Agent #1 already scaffolded.
 *
 * Best-effort. Returns '' if the task isn't part of a convoy or the lookups fail.
 */

import { queryAll, queryOne } from '@/lib/db';

interface SubtaskSnapshot {
  task_id: string;
  title: string;
  status: string;
  sort_order: number;
  agent_name: string | null;
}

interface MissionRow {
  convoy_id: string;
  mission_name: string;
  codebase_path: string | null;
  mission_stage: string | null;
  enable_existing_codebase: number;
}

const MAX_SUMMARY_LEN = 220;

export function buildMissionProgressBlock(taskId: string): string {
  const m = queryOne<MissionRow>(
    `SELECT
       c.id AS convoy_id,
       c.name AS mission_name,
       c.codebase_path AS codebase_path,
       c.mission_stage AS mission_stage,
       c.enable_existing_codebase AS enable_existing_codebase
     FROM tasks t
     JOIN convoys c ON c.id = t.convoy_id
     WHERE t.id = ?`,
    [taskId],
  );
  if (!m) return '';

  const subtasks = queryAll<SubtaskSnapshot>(
    `SELECT cs.task_id, t.title, t.status, cs.sort_order, a.name AS agent_name
     FROM convoy_subtasks cs
     JOIN tasks t ON t.id = cs.task_id
     LEFT JOIN agents a ON a.id = t.assigned_agent_id
     WHERE cs.convoy_id = ?
     ORDER BY cs.sort_order`,
    [m.convoy_id],
  );

  const current = subtasks.find(s => s.task_id === taskId);
  const before = subtasks.filter(s => s.sort_order < (current?.sort_order ?? Infinity));
  const after = subtasks.filter(s => s.sort_order > (current?.sort_order ?? -Infinity));

  const done = before.filter(s => s.status === 'done');
  const running = before.filter(s => s.status === 'in_progress' || s.status === 'assigned' || s.status === 'testing' || s.status === 'verification' || s.status === 'review');
  const pending = after;

  const lines: string[] = [];
  lines.push('## 🎯 Mission Context');
  lines.push(`**Mission:** ${m.mission_name}`);
  if (m.codebase_path) {
    const tag = m.enable_existing_codebase ? 'existing' : 'shared';
    lines.push(`**Project path (${tag}, work HERE — do NOT create a new folder):** \`${m.codebase_path}\``);
  }
  if (m.mission_stage) lines.push(`**Stage:** ${m.mission_stage}`);
  lines.push('');

  if (done.length > 0) {
    lines.push('### ✅ Already done by the team');
    for (const s of done) {
      const summary = lastAssistantSummary(s.task_id);
      const deliverables = listDeliverables(s.task_id);
      lines.push(`- **#${s.sort_order} ${s.title}** — ${s.agent_name ?? 'unassigned'}`);
      if (summary) lines.push(`  - summary: ${trim(summary, MAX_SUMMARY_LEN)}`);
      if (deliverables.length > 0) lines.push(`  - deliverables: ${deliverables.slice(0, 5).join(' · ')}`);
    }
    lines.push('');
  }

  if (running.length > 0) {
    lines.push('### 🔄 In progress right now (parallel work)');
    for (const s of running) {
      lines.push(`- **#${s.sort_order} ${s.title}** — ${s.agent_name ?? 'unassigned'} (${s.status})`);
    }
    lines.push('');
  }

  if (pending.length > 0) {
    lines.push('### 🕓 Up next (do NOT do these yet — other agents will pick them up)');
    for (const s of pending.slice(0, 8)) {
      lines.push(`- #${s.sort_order} ${s.title} — ${s.agent_name ?? 'unassigned'}`);
    }
    if (pending.length > 8) lines.push(`- … and ${pending.length - 8} more`);
    lines.push('');
  }

  lines.push('### Working agreement');
  lines.push('1. Build on what previous agents produced — do not re-scaffold or duplicate their work.');
  lines.push('2. Use the project path above as the working directory. Inspect what already exists before writing.');
  lines.push('3. When you finish, leave a clear note describing what changed so the next agent can continue.');

  return `\n\n---\n\n${lines.join('\n')}\n`;
}

function lastAssistantSummary(taskId: string): string | null {
  const row = queryOne<{ content: string }>(
    `SELECT content FROM task_notes
     WHERE task_id = ? AND role = 'assistant' AND mode = 'direct'
     ORDER BY created_at DESC LIMIT 1`,
    [taskId],
  );
  return row?.content?.trim() ?? null;
}

function listDeliverables(taskId: string): string[] {
  const rows = queryAll<{ title: string; path: string | null }>(
    `SELECT title, path FROM task_deliverables WHERE task_id = ? ORDER BY created_at LIMIT 8`,
    [taskId],
  );
  return rows.map(r => r.path ? `${r.title} (${r.path})` : r.title);
}

function trim(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}
