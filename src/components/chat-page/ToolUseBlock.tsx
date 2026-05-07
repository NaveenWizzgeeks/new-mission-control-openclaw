'use client';

import { useState } from 'react';
import { ChevronRight, Wrench } from 'lucide-react';
import { MessageMarkdown } from './MessageMarkdown';

/**
 * Best-effort tool-use detector for messages emitted by the agent.
 *
 * The OpenClaw gateway returns chat messages as plain text — there is no
 * structured tool-use block. We use heuristics to spot common shapes:
 *
 *   - Lines starting with `🔧 Tool:` / `Tool:` / `Used:`
 *   - Lines starting with `Calling tool ...`
 *   - Self-contained JSON envelopes with `{"tool":"…", ...}` shape
 *
 * Detected blocks are rendered as collapsible cards. The rest renders as
 * normal markdown. This is heuristic — false negatives are fine; false
 * positives just look like a slightly differently-styled paragraph.
 */

interface Segment {
  kind: 'text' | 'tool';
  body: string;
  tool_name?: string;
}

const TOOL_PREFIXES = [
  /^(?:🔧\s*)?Tool:\s*([^\n]+)\n([\s\S]+?)(?=\n\s*\n|$)/m,
  /^Used:\s*([^\n]+)\n([\s\S]+?)(?=\n\s*\n|$)/m,
  /^Calling tool\s+([^\s.…:]+)[.:…]?\s*\n([\s\S]+?)(?=\n\s*\n|$)/m,
];

export function splitForToolBlocks(text: string): Segment[] {
  if (!text) return [];

  const out: Segment[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    let earliest: { match: RegExpExecArray; rule: RegExp } | null = null;
    for (const rule of TOOL_PREFIXES) {
      const m = rule.exec(remaining);
      if (m && (!earliest || m.index < earliest.match.index)) {
        earliest = { match: m, rule };
      }
    }
    if (!earliest) {
      out.push({ kind: 'text', body: remaining });
      break;
    }
    const { match } = earliest;
    if (match.index > 0) {
      out.push({ kind: 'text', body: remaining.slice(0, match.index) });
    }
    out.push({
      kind: 'tool',
      tool_name: match[1].trim(),
      body: match[2].trim(),
    });
    remaining = remaining.slice(match.index + match[0].length);
  }
  return out.filter(s => s.body && s.body.trim().length > 0);
}

export function MessageBody({ text }: { text: string }) {
  const segments = splitForToolBlocks(text);
  if (segments.length === 0) return null;

  return (
    <>
      {segments.map((s, i) => {
        if (s.kind === 'text') return <MessageMarkdown key={i} text={s.body} />;
        return <ToolUseCard key={i} name={s.tool_name ?? 'tool'} body={s.body} />;
      })}
    </>
  );
}

function ToolUseCard({ name, body }: { name: string; body: string }) {
  const [open, setOpen] = useState(false);
  const preview = body.split('\n')[0].slice(0, 80);
  return (
    <div className="my-2 rounded-lg border border-mc-accent-purple/30 bg-mc-accent-purple/5 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-mc-accent-purple/10 transition-colors text-left"
      >
        <ChevronRight className={`w-3 h-3 text-mc-accent-purple transition-transform ${open ? 'rotate-90' : ''}`} />
        <Wrench className="w-3 h-3 text-mc-accent-purple" />
        <span className="text-[11px] uppercase tracking-wider text-mc-accent-purple font-medium">{name}</span>
        {!open && (
          <span className="text-[11px] text-mc-text-secondary truncate">{preview}{body.length > 80 ? '…' : ''}</span>
        )}
      </button>
      {open && (
        <div className="px-3 py-2 border-t border-mc-accent-purple/20 text-[12px]">
          <MessageMarkdown text={body} />
        </div>
      )}
    </div>
  );
}
