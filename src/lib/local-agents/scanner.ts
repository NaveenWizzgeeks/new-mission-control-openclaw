/**
 * Discover agent definitions on the local filesystem.
 *
 * We scan four well-known roots, normalising different conventions to a
 * single shape:
 *
 *   ~/.claude/agents/<name>.md             — Claude Code subagent (frontmatter + body)
 *   ~/.codex/agents/<name>.md              — Codex CLI subagent (same convention)
 *   ~/.agents/<name>/SOUL.md               — generic SOUL convention (one dir per agent)
 *   ~/.openclaw/agents/<name>/agent/SOUL.md (if present)
 *
 * Names default to the file basename or the directory name. Soul content is
 * the body text minus YAML frontmatter, capped at 4KB so the discover
 * endpoint stays cheap.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export type AgentSource = 'claude' | 'codex' | 'agents' | 'openclaw';

export interface DiscoveredAgent {
  source: AgentSource;
  path: string;
  name: string;
  soul_excerpt: string;
  size_bytes: number;
  modified_at: string;
}

const SOUL_EXCERPT_MAX = 4096;

const ROOTS: Array<{ source: AgentSource; root: string; layout: 'flat-md' | 'dir-soul' | 'openclaw' }> = [
  { source: 'claude',   root: path.join(os.homedir(), '.claude', 'agents'),   layout: 'flat-md' },
  { source: 'codex',    root: path.join(os.homedir(), '.codex', 'agents'),    layout: 'flat-md' },
  { source: 'agents',   root: path.join(os.homedir(), '.agents'),             layout: 'dir-soul' },
  { source: 'openclaw', root: path.join(os.homedir(), '.openclaw', 'agents'), layout: 'openclaw' },
];

export function discoverLocalAgents(): { agents: DiscoveredAgent[]; roots_scanned: string[]; roots_missing: string[] } {
  const out: DiscoveredAgent[] = [];
  const scanned: string[] = [];
  const missing: string[] = [];

  for (const r of ROOTS) {
    let exists = false;
    try { exists = fs.statSync(r.root).isDirectory(); } catch { exists = false; }
    if (!exists) { missing.push(r.root); continue; }
    scanned.push(r.root);

    try {
      if (r.layout === 'flat-md') {
        const entries = fs.readdirSync(r.root, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isFile() || !e.name.endsWith('.md')) continue;
          const full = path.join(r.root, e.name);
          const a = readAgentFile(r.source, full, path.basename(e.name, '.md'));
          if (a) out.push(a);
        }
      } else if (r.layout === 'dir-soul') {
        const entries = fs.readdirSync(r.root, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const candidates = ['SOUL.md', 'soul.md', 'AGENT.md', 'README.md'];
          for (const c of candidates) {
            const full = path.join(r.root, e.name, c);
            if (fs.existsSync(full)) {
              const a = readAgentFile(r.source, full, e.name);
              if (a) out.push(a);
              break;
            }
          }
        }
      } else if (r.layout === 'openclaw') {
        // ~/.openclaw/agents/<name>/agent/SOUL.md (or AGENT.md, or just runtime metadata)
        const entries = fs.readdirSync(r.root, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const candidates = [
            path.join(r.root, e.name, 'agent', 'SOUL.md'),
            path.join(r.root, e.name, 'SOUL.md'),
            path.join(r.root, e.name, 'AGENT.md'),
          ];
          let found: string | null = null;
          for (const c of candidates) {
            if (fs.existsSync(c)) { found = c; break; }
          }
          if (found) {
            const a = readAgentFile(r.source, found, e.name);
            if (a) out.push(a);
          } else {
            // Even without a SOUL file we can record an OpenClaw runtime agent
            // so the user knows it exists. Stub the soul excerpt.
            const stat = safeStat(path.join(r.root, e.name));
            if (stat) {
              out.push({
                source: r.source,
                path: path.join(r.root, e.name),
                name: e.name,
                soul_excerpt: '(OpenClaw runtime agent — no SOUL.md found)',
                size_bytes: 0,
                modified_at: stat.mtime.toISOString(),
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn('[local-agents] scan failed for', r.root, err);
    }
  }

  return { agents: out, roots_scanned: scanned, roots_missing: missing };
}

function readAgentFile(source: AgentSource, full: string, name: string): DiscoveredAgent | null {
  try {
    const stat = fs.statSync(full);
    const raw = fs.readFileSync(full, 'utf8');
    const stripped = stripFrontmatter(raw);
    return {
      source,
      path: full,
      name: name.trim(),
      soul_excerpt: stripped.slice(0, SOUL_EXCERPT_MAX),
      size_bytes: stat.size,
      modified_at: stat.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

function safeStat(p: string): fs.Stats | null {
  try { return fs.statSync(p); } catch { return null; }
}

function stripFrontmatter(raw: string): string {
  if (raw.startsWith('---\n')) {
    const end = raw.indexOf('\n---\n', 4);
    if (end !== -1) return raw.slice(end + 5).trimStart();
  }
  return raw;
}
