/**
 * Message-text scanner for inbound/outbound chat content.
 *
 * Distinct from the marketplace scanner (`src/lib/skills-marketplace/scanner.ts`)
 * which scans skill *configs* before install. This scanner runs over arbitrary
 * chat / tool-call text and is biased toward leaks (secrets going OUT of the
 * agent) and prompt-injection (commands coming IN to the agent).
 *
 * Findings are NOT thrown — they're returned for the caller to persist via
 * `recordFindings()` and surface in the UI.
 */

export type Severity = 'critical' | 'warning' | 'info';

export interface MessageFinding {
  severity: Severity;
  code: string;
  message: string;
  /** A short excerpt around the match. Truncated to ~160 chars; never the full message. */
  evidence?: string;
}

const SECRET_PATTERNS: Array<{ re: RegExp; code: string; msg: string }> = [
  { re: /\bsk-[a-zA-Z0-9]{20,}\b/, code: 'secret.openai_key', msg: 'Looks like an OpenAI API key.' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, code: 'secret.aws_access_key', msg: 'Looks like an AWS access key ID.' },
  { re: /\bAIza[0-9A-Za-z\-_]{35}\b/, code: 'secret.google_key', msg: 'Looks like a Google API key.' },
  { re: /\bxox[baprs]-[0-9a-zA-Z\-]{10,}\b/, code: 'secret.slack_token', msg: 'Looks like a Slack token.' },
  { re: /\bghp_[A-Za-z0-9]{36}\b/, code: 'secret.github_pat', msg: 'Looks like a GitHub personal access token.' },
  { re: /\bgho_[A-Za-z0-9]{36}\b/, code: 'secret.github_oauth', msg: 'Looks like a GitHub OAuth token.' },
  { re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, code: 'secret.private_key', msg: 'Embedded private key.' },
  { re: /\bBearer\s+[A-Za-z0-9._\-]{20,}/i, code: 'secret.bearer_token', msg: 'A Bearer token appears in the message.' },
  // Generic high-entropy "key" assignment — broad but only fires on lines that look like assignments.
  { re: /\b(api[_-]?key|secret|password|passwd)\s*[:=]\s*['"`]?[A-Za-z0-9._\-]{16,}['"`]?/i, code: 'secret.assignment', msg: 'A credential-like assignment is present in plain text.' },
];

const PROMPT_INJECTION_PATTERNS: Array<{ re: RegExp; code: string; msg: string }> = [
  { re: /\bignore (all |the |any )?(previous|prior|above) (instructions?|prompts?|messages?)\b/i, code: 'inject.ignore_previous', msg: 'Classic prompt-injection trigger phrase.' },
  { re: /\byou are now [a-z ]{3,40}\b/i, code: 'inject.role_override', msg: 'Attempts to override the agent role.' },
  { re: /\bsystem:\s/i, code: 'inject.system_role', msg: 'Tries to inject a synthetic system message.' },
  { re: /<\|im_(start|end)\|>/, code: 'inject.chat_template_token', msg: 'Embeds a chat-template control token.' },
  { re: /\breveal (your |the )?(system|hidden|internal) prompt\b/i, code: 'inject.exfil_prompt', msg: 'Attempts to exfiltrate the system prompt.' },
  { re: /\b(disregard|forget) (all|any|the) (previous|prior|above) (rules|instructions|context)\b/i, code: 'inject.disregard_rules', msg: 'Asks the agent to disregard prior rules.' },
  { re: /\boverride (your |the )?safety\b/i, code: 'inject.override_safety', msg: 'Attempts to override safety constraints.' },
];

const DANGEROUS_TOOL_PATTERNS: Array<{ re: RegExp; code: string; msg: string }> = [
  { re: /\brm\s+-rf?\s+\/(?!\w)/, code: 'tool.rm_root', msg: 'Tool call removes from filesystem root.' },
  { re: /\b(curl|wget)[^|]*\|\s*(bash|sh|zsh)\b/, code: 'tool.pipe_to_shell', msg: 'Tool pipes a remote download into a shell.' },
  { re: /\bsudo\b/, code: 'tool.sudo', msg: 'Tool call requests root.' },
];

const MAX_EVIDENCE_LEN = 160;

function excerpt(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 30);
  const end = Math.min(text.length, match.index + match[0].length + 30);
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet += '…';
  return snippet.length > MAX_EVIDENCE_LEN
    ? snippet.slice(0, MAX_EVIDENCE_LEN - 1) + '…'
    : snippet;
}

function scanWith(
  text: string,
  rules: Array<{ re: RegExp; code: string; msg: string }>,
  severity: Severity,
): MessageFinding[] {
  const out: MessageFinding[] = [];
  for (const { re, code, msg } of rules) {
    const m = re.exec(text);
    if (m) {
      out.push({ severity, code, message: msg, evidence: excerpt(text, m) });
    }
  }
  return out;
}

/**
 * Scan a message coming FROM the user TO the agent.
 * High-priority concerns: prompt injection, dangerous instructions.
 * Secrets are flagged warning here (the user may be sharing their own).
 */
export function scanInbound(text: string): MessageFinding[] {
  if (!text || text.length === 0) return [];
  const out: MessageFinding[] = [];
  out.push(...scanWith(text, PROMPT_INJECTION_PATTERNS, 'critical'));
  out.push(...scanWith(text, SECRET_PATTERNS, 'warning'));
  return dedupe(out);
}

/**
 * Scan a message FROM the agent TO the user (or to logs).
 * High-priority concern: secret leakage. Dangerous tool calls in agent output
 * are flagged for review.
 */
export function scanOutbound(text: string): MessageFinding[] {
  if (!text || text.length === 0) return [];
  const out: MessageFinding[] = [];
  out.push(...scanWith(text, SECRET_PATTERNS, 'critical'));
  out.push(...scanWith(text, DANGEROUS_TOOL_PATTERNS, 'warning'));
  return dedupe(out);
}

/**
 * Scan an MCP / shell tool-call payload (arguments, target URL, etc).
 */
export function scanToolCall(text: string): MessageFinding[] {
  if (!text || text.length === 0) return [];
  const out: MessageFinding[] = [];
  out.push(...scanWith(text, DANGEROUS_TOOL_PATTERNS, 'critical'));
  out.push(...scanWith(text, SECRET_PATTERNS, 'warning'));
  return dedupe(out);
}

function dedupe(findings: MessageFinding[]): MessageFinding[] {
  const seen = new Set<string>();
  const out: MessageFinding[] = [];
  for (const f of findings) {
    const k = `${f.severity}:${f.code}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}
