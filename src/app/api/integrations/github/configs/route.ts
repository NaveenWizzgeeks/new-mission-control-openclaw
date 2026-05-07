import { NextRequest, NextResponse } from 'next/server';
import { listConfigs, createConfig } from '@/lib/github/sync';
import { GitHubClient } from '@/lib/github/client';

export const dynamic = 'force-dynamic';

function maskToken(t: string): string {
  if (t.length < 12) return '***';
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

export async function GET() {
  // Mask the token in API responses — never echo it back to the browser.
  const items = listConfigs().map(c => ({ ...c, token: maskToken(c.token) }));
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  let body: { workspace_id?: string; mission_id?: string; repo_owner?: string; repo_name?: string; token?: string; default_label?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'validation_failed' }, { status: 400 });
  }

  const { repo_owner, repo_name, token, workspace_id, mission_id, default_label } = body;
  if (!repo_owner || !repo_name) {
    return NextResponse.json({ error: 'repo_owner and repo_name are required', code: 'validation_failed' }, { status: 400 });
  }
  if (!token || token.length < 16) {
    return NextResponse.json({ error: 'token (PAT) is required and must look real', code: 'validation_failed' }, { status: 400 });
  }
  if (!workspace_id && !mission_id) {
    return NextResponse.json(
      { error: 'Provide either workspace_id (workspace default) or mission_id (mission override)', code: 'validation_failed' },
      { status: 400 }
    );
  }

  // Validate the token actually works against the repo before persisting.
  const client = new GitHubClient(token, repo_owner, repo_name);
  const ping = await client.ping();
  if (!ping.ok) {
    return NextResponse.json(
      { error: 'GitHub authentication failed (bad PAT or insufficient scope)', code: 'auth_failed' },
      { status: 401 }
    );
  }

  const cfg = createConfig({ workspace_id, mission_id, repo_owner, repo_name, token, default_label });
  return NextResponse.json(
    { ...cfg, token: maskToken(cfg.token), validated_as: ping.login },
    { status: 201 }
  );
}
