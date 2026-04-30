import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveTarget, runTests, type ParsedResults } from '@/lib/playwright/runner';
import type { Convoy, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RunBody { cwd?: string; timeoutMs?: number }

// POST /api/missions/[id]/playwright/run
//
// Runs `npx playwright test --reporter=json` against the given cwd (defaults
// to the mission's codebase_path or workspace path) and returns parsed
// results. Failed tests are surfaced; auto-propose hookup for failures is a
// future step.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const db = getDb();
    const convoy = db.prepare('SELECT * FROM convoys WHERE id = ?').get(id) as Convoy | undefined;
    if (!convoy) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

    const parent = db.prepare('SELECT * FROM tasks WHERE id = ?').get(convoy.parent_task_id) as Task | undefined;
    if (!parent) return NextResponse.json({ error: 'Parent task missing' }, { status: 500 });

    let body: RunBody = {};
    try { body = await request.json(); } catch { /* empty body is fine */ }

    // Resolve target: explicit body.cwd > mission.codebase_path > workspace.path
    let cwd = body.cwd?.trim();
    if (!cwd) cwd = convoy.codebase_path?.trim() || undefined;
    if (!cwd) {
      const ws = db.prepare('SELECT path FROM workspaces WHERE id = ?').get(parent.workspace_id) as { path: string | null } | undefined;
      cwd = ws?.path?.trim() || undefined;
    }
    if (!cwd) {
      return NextResponse.json(
        {
          error: 'No directory to run against. Set the mission codebase_path or pass {"cwd":"/abs/path"} in the body.',
          code: 'no_cwd',
        },
        { status: 400 }
      );
    }

    const probe = resolveTarget(cwd);
    if (!probe.ok) {
      return NextResponse.json({ error: probe.reason ?? 'cwd is not usable', code: 'invalid_cwd', probe }, { status: 400 });
    }
    if (!probe.installed) {
      return NextResponse.json(
        {
          error: 'Playwright is not installed in this project. Run `npx playwright install --with-deps chromium` first.',
          code: 'playwright_missing',
          probe,
        },
        { status: 412 }
      );
    }

    const result = await runTests(probe.cwd, { timeoutMs: body.timeoutMs });

    return NextResponse.json({
      ok: result.ok,
      probe,
      duration_ms: result.duration_ms,
      exit_code: result.exitCode,
      results: result.results ?? emptyResults(),
      stderr: result.error ?? null,
    });
  } catch (error) {
    console.error('[Mission playwright/run] failed:', error);
    return NextResponse.json({ error: 'Failed to run Playwright', code: 'internal_error', detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function emptyResults(): ParsedResults {
  return { passed: 0, failed: 0, skipped: 0, duration_ms: 0, tests: [], total: 0 };
}
