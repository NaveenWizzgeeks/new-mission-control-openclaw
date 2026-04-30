import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDb, queryAll } from '@/lib/db';

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

// GET /api/skills?agent_id=...
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agent_id') ?? searchParams.get('agentId');
  if (!agentId) {
    return NextResponse.json({ error: 'agent_id query param is required' }, { status: 400 });
  }

  const rows = queryAll<SkillRow>(
    `SELECT id, agent_id, skill_type, skill_name, skill_config, enabled, created_at
     FROM agent_skills WHERE agent_id = ?
     ORDER BY skill_type, skill_name`,
    [agentId]
  );
  return NextResponse.json(rows.map(r => ({
    ...r,
    enabled: !!r.enabled,
    config: safeJSON(r.skill_config),
  })));
}

// POST /api/skills  body: { agent_id, skill_type, skill_name, skill_config? (object) }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agent_id, skill_type, skill_name, skill_config, enabled } = body as {
      agent_id?: string; skill_type?: string; skill_name?: string; skill_config?: unknown; enabled?: boolean;
    };

    if (!agent_id || typeof agent_id !== 'string') {
      return NextResponse.json({ error: 'agent_id is required', code: 'validation_failed' }, { status: 400 });
    }
    if (!skill_type || !SKILL_TYPES.includes(skill_type as SkillType)) {
      return NextResponse.json({ error: `skill_type must be one of ${SKILL_TYPES.join(', ')}`, code: 'validation_failed' }, { status: 400 });
    }
    if (!skill_name || typeof skill_name !== 'string' || skill_name.trim().length === 0) {
      return NextResponse.json({ error: 'skill_name is required', code: 'validation_failed' }, { status: 400 });
    }

    const db = getDb();
    const agent = db.prepare('SELECT id FROM agents WHERE id = ?').get(agent_id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const id = uuidv4();
    const cfg = skill_config && typeof skill_config === 'object' ? JSON.stringify(skill_config) : '{}';
    try {
      db.prepare(`
        INSERT INTO agent_skills (id, agent_id, skill_type, skill_name, skill_config, enabled, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(id, agent_id, skill_type, skill_name.trim(), cfg, enabled === false ? 0 : 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('UNIQUE constraint failed')) {
        return NextResponse.json(
          { error: `Agent already has a skill named "${skill_name}". Edit or delete it first.`, code: 'duplicate_skill' },
          { status: 409 }
        );
      }
      throw err;
    }

    const row = db.prepare(`
      SELECT id, agent_id, skill_type, skill_name, skill_config, enabled, created_at
      FROM agent_skills WHERE id = ?
    `).get(id) as SkillRow;

    return NextResponse.json({ ...row, enabled: !!row.enabled, config: safeJSON(row.skill_config) }, { status: 201 });
  } catch (error) {
    console.error('[Skills API] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create skill', code: 'internal_error' }, { status: 500 });
  }
}

function safeJSON(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
