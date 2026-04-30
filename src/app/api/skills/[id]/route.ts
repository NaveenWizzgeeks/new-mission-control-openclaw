import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const SKILL_TYPES = ['shell', 'mcp', 'prompt_inject', 'file_access'] as const;
type SkillType = typeof SKILL_TYPES[number];

interface SkillRow {
  id: string;
  agent_id: string;
  skill_type: SkillType;
  skill_name: string;
  skill_config: string;
  enabled: number;
  created_at: string;
}

function safeJSON(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// PATCH /api/skills/[id] — partial update
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json() as Partial<{
      skill_type: SkillType; skill_name: string; skill_config: unknown; enabled: boolean;
    }>;
    const db = getDb();
    const existing = db.prepare('SELECT * FROM agent_skills WHERE id = ?').get(id) as SkillRow | undefined;
    if (!existing) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });

    const updates: string[] = [];
    const values: unknown[] = [];
    if (body.skill_type !== undefined) {
      if (!SKILL_TYPES.includes(body.skill_type)) {
        return NextResponse.json({ error: `skill_type must be one of ${SKILL_TYPES.join(', ')}` }, { status: 400 });
      }
      updates.push('skill_type = ?'); values.push(body.skill_type);
    }
    if (body.skill_name !== undefined) {
      if (typeof body.skill_name !== 'string' || !body.skill_name.trim()) {
        return NextResponse.json({ error: 'skill_name must be a non-empty string' }, { status: 400 });
      }
      updates.push('skill_name = ?'); values.push(body.skill_name.trim());
    }
    if (body.skill_config !== undefined) {
      const cfg = body.skill_config && typeof body.skill_config === 'object' ? JSON.stringify(body.skill_config) : '{}';
      updates.push('skill_config = ?'); values.push(cfg);
    }
    if (body.enabled !== undefined) {
      updates.push('enabled = ?'); values.push(body.enabled ? 1 : 0);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(id);
    try {
      db.prepare(`UPDATE agent_skills SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('UNIQUE constraint failed')) {
        return NextResponse.json({ error: 'Another skill on this agent already has that name', code: 'duplicate_skill' }, { status: 409 });
      }
      throw err;
    }

    const row = db.prepare(`SELECT * FROM agent_skills WHERE id = ?`).get(id) as SkillRow;
    return NextResponse.json({ ...row, enabled: !!row.enabled, config: safeJSON(row.skill_config) });
  } catch (error) {
    console.error('[Skills API] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update skill' }, { status: 500 });
  }
}

// DELETE /api/skills/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM agent_skills WHERE id = ?').get(id);
    if (!existing) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    db.prepare('DELETE FROM agent_skills WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Skills API] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 });
  }
}
