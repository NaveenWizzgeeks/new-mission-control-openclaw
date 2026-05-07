/**
 * Detects subtask proposal blocks inside a Fury reply.
 *
 * Fury's planning prompts ask for replies shaped like:
 *   {
 *     "status": "complete",
 *     "subtasks": [{ "title": "...", "description": "...", "agent_role": "..." }]
 *   }
 *
 * In the Ask-Fury chat, those payloads come back inside a markdown fence
 * (```json … ```), inside a plain ``` fence, or rarely as a bare object
 * pasted into prose. We scan for any of those forms, accept anything that
 * parses to an object containing a non-empty `subtasks` array, and return
 * (a) the cleaned text without those JSON blocks and (b) the parsed specs
 * for the UI to render as approval cards.
 *
 * The parser is strict on output shape but tolerant on input:
 * - missing/extra fields on a subtask are kept; the from-chat endpoint
 *   validates them before insert.
 * - blocks that fail JSON.parse, or parse to something without `subtasks`,
 *   stay in the cleaned text so users still see them.
 */

export interface ProposalSpec {
  title: string;
  description?: string;
  agent_role?: 'planner' | 'builder' | 'tester' | 'reviewer' | 'general';
  priority?: number;
  needs_planning?: boolean;
}

export interface ProposalBlock {
  /** Index in the cleaned text where this block was — useful for ordering. */
  position: number;
  subtasks: ProposalSpec[];
}

interface ParsedProposals {
  cleaned: string;
  blocks: ProposalBlock[];
}

const FENCED_JSON_RE = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
const BARE_OBJECT_RE = /(\{[\s\S]*?"subtasks"\s*:\s*\[[\s\S]*?\][\s\S]*?\})/g;

function tryParseSpec(raw: string): ProposalSpec[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  // Accept either { subtasks: [...] } directly or { spec: { subtasks: [...] } }
  let arr = obj.subtasks;
  if (!Array.isArray(arr) && obj.spec && typeof obj.spec === 'object') {
    const inner = (obj.spec as Record<string, unknown>).subtasks;
    if (Array.isArray(inner)) arr = inner;
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const specs: ProposalSpec[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    if (typeof it.title !== 'string' || !it.title.trim()) continue;
    specs.push({
      title: String(it.title).trim().slice(0, 500),
      description: typeof it.description === 'string' ? it.description : undefined,
      agent_role: typeof it.agent_role === 'string' ? (it.agent_role as ProposalSpec['agent_role']) : undefined,
      priority: typeof it.priority === 'number' ? it.priority : undefined,
      needs_planning: typeof it.needs_planning === 'boolean' ? it.needs_planning : undefined,
    });
  }
  return specs.length > 0 ? specs : null;
}

export function parseProposalBlocks(text: string): ParsedProposals {
  if (!text) return { cleaned: text, blocks: [] };
  const blocks: ProposalBlock[] = [];

  let cleaned = text.replace(FENCED_JSON_RE, (match, body: string, offset: number) => {
    const specs = tryParseSpec(body);
    if (!specs) return match; // leave the fence in the visible text
    blocks.push({ position: offset, subtasks: specs });
    return '';
  });

  // Bare-object fallback: only run on what's left after fence stripping.
  // Stop after the first match per scan to avoid quadratic regex cost.
  cleaned = cleaned.replace(BARE_OBJECT_RE, (match, body: string, offset: number) => {
    const specs = tryParseSpec(body);
    if (!specs) return match;
    blocks.push({ position: offset, subtasks: specs });
    return '';
  });

  return { cleaned: cleaned.trim(), blocks };
}
