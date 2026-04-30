import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// PATCH /api/skills/[id]/toggle — flip enabled
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const db = getDb();
    const row = db.prepare('SELECT id, enabled FROM agent_skills WHERE id = ?').get(id) as { id: string; enabled: number } | undefined;
    if (!row) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    const next = row.enabled ? 0 : 1;
    db.prepare('UPDATE agent_skills SET enabled = ? WHERE id = ?').run(next, id);
    return NextResponse.json({ ok: true, enabled: !!next });
  } catch (error) {
    console.error('[Skills API] toggle failed:', error);
    return NextResponse.json({ error: 'Failed to toggle skill' }, { status: 500 });
  }
}
