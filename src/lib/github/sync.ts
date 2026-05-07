/**
 * Mission ↔ GitHub Issue sync.
 *
 * Outbound: when a mission is created or its stage changes, mirror to a
 * GitHub issue (create on first sync, patch on subsequent). Stage maps
 * to a label set so dashboards can filter.
 *
 * Inbound: a poller iterates github_sync_links, fetches each issue with
 * etag short-circuit, and updates local mission_stage if the issue was
 * closed externally. (Comments/assignees not synced in v1.)
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb, queryAll, queryOne } from '@/lib/db';
import { GitHubClient } from './client';

export interface SyncConfigRow {
  id: string;
  workspace_id: string | null;
  mission_id: string | null;
  repo_owner: string;
  repo_name: string;
  token: string;
  default_label: string | null;
  sync_enabled: number;
  last_sync_at: string | null;
  created_at: string;
}

export interface SyncLinkRow {
  id: string;
  mission_id: string;
  repo_owner: string;
  repo_name: string;
  issue_number: number;
  issue_state: string | null;
  last_synced_at: string | null;
  last_etag: string | null;
  created_at: string;
}

const STAGE_LABELS: Record<string, string[]> = {
  backlog: [],
  planning: ['planning'],
  in_progress: ['in-progress'],
  testing: ['testing'],
  done: [],
  paused: ['on-hold'],
};

function pickConfig(missionId: string, workspaceId: string | null): SyncConfigRow | null {
  // Mission-specific override wins over workspace default.
  const mission = queryOne<SyncConfigRow>(
    `SELECT * FROM github_sync_config WHERE mission_id = ? AND sync_enabled = 1 LIMIT 1`,
    [missionId],
  );
  if (mission) return mission;
  if (!workspaceId) return null;
  return queryOne<SyncConfigRow>(
    `SELECT * FROM github_sync_config WHERE workspace_id = ? AND mission_id IS NULL AND sync_enabled = 1 LIMIT 1`,
    [workspaceId],
  ) ?? null;
}

interface MissionRow {
  id: string;
  workspace_id: string | null;
  name: string;
  stage: string;
  parent_task_id: string;
  description: string | null;
  codebase_path: string | null;
}

function getMissionForSync(missionId: string): MissionRow | null {
  const row = queryOne<MissionRow>(
    `SELECT c.id, t.workspace_id, c.name, c.mission_stage AS stage, c.parent_task_id,
            t.description, c.codebase_path
     FROM convoys c JOIN tasks t ON c.parent_task_id = t.id
     WHERE c.id = ?`,
    [missionId],
  );
  return row ?? null;
}

function buildIssueBody(mission: { name: string; stage: string; description: string | null; codebase_path: string | null }): string {
  const lines: string[] = [];
  if (mission.description) lines.push(mission.description.trim(), '');
  lines.push('---');
  lines.push(`**Stage:** \`${mission.stage}\``);
  if (mission.codebase_path) lines.push(`**Project path:** \`${mission.codebase_path}\``);
  lines.push('');
  lines.push('_Synced from autensa Mission Control. Subsequent stage transitions update this issue._');
  return lines.join('\n');
}

/**
 * Outbound sync. Idempotent: creates the issue once (writes a link row),
 * then patches title/body/labels/state on every subsequent call.
 */
export async function syncMissionToGitHub(missionId: string): Promise<{
  ok: boolean;
  action: 'created' | 'updated' | 'noop';
  issue_number?: number;
  error?: string;
}> {
  const mission = getMissionForSync(missionId);
  if (!mission) return { ok: false, action: 'noop', error: 'Mission not found' };

  const cfg = pickConfig(missionId, mission.workspace_id);
  if (!cfg) return { ok: false, action: 'noop', error: 'No GitHub sync config for this mission/workspace' };

  const client = new GitHubClient(cfg.token, cfg.repo_owner, cfg.repo_name);
  const labels = [
    ...(cfg.default_label ? [cfg.default_label] : []),
    ...(STAGE_LABELS[mission.stage] ?? []),
  ];
  const body = buildIssueBody(mission);
  const state: 'open' | 'closed' = mission.stage === 'done' ? 'closed' : 'open';

  const link = queryOne<SyncLinkRow>(
    `SELECT * FROM github_sync_links WHERE mission_id = ?`,
    [missionId],
  );

  const db = getDb();
  const now = new Date().toISOString();

  try {
    if (link) {
      await client.updateIssue(link.issue_number, { title: mission.name, body, labels, state });
      db.prepare(`
        UPDATE github_sync_links
        SET last_synced_at = ?, issue_state = ?
        WHERE mission_id = ?
      `).run(now, state, missionId);
      db.prepare(`UPDATE github_sync_config SET last_sync_at = ? WHERE id = ?`).run(now, cfg.id);
      return { ok: true, action: 'updated', issue_number: link.issue_number };
    }

    const issue = await client.createIssue({ title: mission.name, body, labels });
    db.prepare(`
      INSERT INTO github_sync_links (id, mission_id, repo_owner, repo_name, issue_number, issue_state, last_synced_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(uuidv4(), missionId, cfg.repo_owner, cfg.repo_name, issue.number, issue.state, now);
    db.prepare(`UPDATE github_sync_config SET last_sync_at = ? WHERE id = ?`).run(now, cfg.id);
    return { ok: true, action: 'created', issue_number: issue.number };
  } catch (err) {
    return { ok: false, action: 'noop', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Inbound poll. For each tracked link, fetch the issue with etag. If the
 * issue was closed externally, advance the mission to 'done' (only when the
 * mission isn't already done — never reopen).
 */
export async function pollGitHubForUpdates(): Promise<{
  ok: boolean;
  scanned: number;
  changed: number;
  errors: number;
}> {
  const links = queryAll<SyncLinkRow>(`SELECT * FROM github_sync_links`);
  if (links.length === 0) return { ok: true, scanned: 0, changed: 0, errors: 0 };

  const db = getDb();
  let changed = 0;
  let errors = 0;

  for (const link of links) {
    const cfg = queryOne<SyncConfigRow>(
      `SELECT * FROM github_sync_config WHERE repo_owner = ? AND repo_name = ? AND sync_enabled = 1 ORDER BY mission_id DESC LIMIT 1`,
      [link.repo_owner, link.repo_name],
    );
    if (!cfg) continue;

    try {
      const client = new GitHubClient(cfg.token, link.repo_owner, link.repo_name);
      const r = await client.getIssue(link.issue_number, link.last_etag ?? undefined);

      if (r.not_modified) continue;
      if (!r.issue) continue;

      const newState = r.issue.state;
      const stateChanged = newState !== link.issue_state;
      db.prepare(`
        UPDATE github_sync_links
        SET issue_state = ?, last_etag = ?, last_synced_at = ?
        WHERE id = ?
      `).run(newState, r.etag, new Date().toISOString(), link.id);

      // Only auto-advance LOCAL mission stage when issue was closed externally
      // and the mission isn't already done. Never reopen — that's destructive
      // and the user might have manually marked done locally for other reasons.
      if (stateChanged && newState === 'closed') {
        const mission = queryOne<{ mission_stage: string }>(
          `SELECT mission_stage FROM convoys WHERE id = ?`,
          [link.mission_id],
        );
        if (mission && mission.mission_stage !== 'done') {
          db.prepare(`
            UPDATE convoys SET mission_stage = 'done', updated_at = datetime('now') WHERE id = ?
          `).run(link.mission_id);
          changed += 1;
        }
      }
    } catch (err) {
      console.error('[github sync] poll error for link', link.id, err);
      errors += 1;
    }
  }

  return { ok: errors === 0, scanned: links.length, changed, errors };
}

export function listConfigs(): SyncConfigRow[] {
  return queryAll<SyncConfigRow>(`SELECT * FROM github_sync_config ORDER BY created_at DESC`);
}

export function listLinks(): Array<SyncLinkRow & { mission_name: string | null }> {
  return queryAll(`
    SELECT l.*, c.name AS mission_name
    FROM github_sync_links l
    LEFT JOIN convoys c ON c.id = l.mission_id
    ORDER BY l.created_at DESC
  `);
}

export function deleteConfig(id: string): boolean {
  const r = getDb().prepare(`DELETE FROM github_sync_config WHERE id = ?`).run(id);
  return r.changes > 0;
}

export function createConfig(args: {
  workspace_id?: string | null;
  mission_id?: string | null;
  repo_owner: string;
  repo_name: string;
  token: string;
  default_label?: string | null;
}): SyncConfigRow {
  const id = uuidv4();
  getDb().prepare(`
    INSERT INTO github_sync_config (id, workspace_id, mission_id, repo_owner, repo_name, token, default_label, sync_enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `).run(
    id,
    args.workspace_id ?? null,
    args.mission_id ?? null,
    args.repo_owner.trim(),
    args.repo_name.trim(),
    args.token,
    args.default_label?.trim() ?? null,
  );
  return queryOne<SyncConfigRow>(`SELECT * FROM github_sync_config WHERE id = ?`, [id])!;
}
