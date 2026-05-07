import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Phase 13N.3: one-time + reusable cleanup of orphan task rows.
 *
 * An "orphan" is a task with `convoy_id` set but the parent convoy no longer
 * exists. This happens when missions were deleted before Phase 13N.3 (when
 * the default was to KEEP subtask rows). Without cleanup these tasks can be
 * re-dispatched and recreate stray project folders.
 *
 * GET  → preview (count + list)
 * POST → actually delete
 *
 * Both also clean up FK references in adjacent tables so the deletes succeed
 * (mirrors the convoys-delete cleanup).
 */
export async function GET() {
  const db = getDb();
  const orphans = db.prepare(`
    SELECT id, title, status, convoy_id, created_at
    FROM tasks
    WHERE convoy_id IS NOT NULL
      AND convoy_id NOT IN (SELECT id FROM convoys)
    ORDER BY created_at DESC
  `).all();
  return NextResponse.json({ count: orphans.length, items: orphans });
}

export async function POST(_request: NextRequest) {
  const db = getDb();
  const orphanIds = (db.prepare(`
    SELECT id FROM tasks
    WHERE convoy_id IS NOT NULL
      AND convoy_id NOT IN (SELECT id FROM convoys)
  `).all() as Array<{ id: string }>).map(r => r.id);

  if (orphanIds.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0 });
  }

  const placeholders = orphanIds.map(() => '?').join(',');
  const tx = db.transaction(() => {
    // Same FK cleanup pattern as DELETE /api/missions/[id]
    db.prepare(`DELETE FROM events WHERE task_id IN (${placeholders})`).run(...orphanIds);
    db.prepare(`DELETE FROM agent_health WHERE task_id IN (${placeholders})`).run(...orphanIds);
    db.prepare(`DELETE FROM openclaw_sessions WHERE task_id IN (${placeholders})`).run(...orphanIds);
    db.prepare(`DELETE FROM cost_events WHERE task_id IN (${placeholders})`).run(...orphanIds);
    db.prepare(`DELETE FROM workspace_ports WHERE task_id IN (${placeholders})`).run(...orphanIds);
    db.prepare(`DELETE FROM workspace_merges WHERE task_id IN (${placeholders})`).run(...orphanIds);
    db.prepare(`DELETE FROM conversations WHERE task_id IN (${placeholders})`).run(...orphanIds);
    db.prepare(`DELETE FROM rollback_history WHERE task_id IN (${placeholders})`).run(...orphanIds);
    db.prepare(`DELETE FROM skill_reports WHERE task_id IN (${placeholders})`).run(...orphanIds);
    db.prepare(`DELETE FROM content_inventory WHERE task_id IN (${placeholders})`).run(...orphanIds);
    // Phase 13N.3: also clean up the NO-ACTION FK references that the
    // mission DELETE handler missed. Without these the orphan delete fails
    // with FOREIGN KEY constraint failed.
    db.prepare(`UPDATE product_skills SET created_by_task_id = NULL WHERE created_by_task_id IN (${placeholders})`).run(...orphanIds);
    db.prepare(`UPDATE ideas SET task_id = NULL WHERE task_id IN (${placeholders})`).run(...orphanIds);
    db.prepare(`UPDATE knowledge_entries SET task_id = NULL WHERE task_id IN (${placeholders})`).run(...orphanIds);
    // (agent_mailbox has no task_id column — refs are by convoy_id; convoy already gone)
    // Finally the tasks themselves (cascades to task_notes, task_deliverables, etc via their own FKs)
    db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...orphanIds);
  });
  tx();

  return NextResponse.json({ ok: true, deleted: orphanIds.length });
}
