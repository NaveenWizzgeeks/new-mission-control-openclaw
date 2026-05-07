import type { SkillType } from '@/lib/agentSkills';
import type { SecurityFinding } from './types';

const DANGEROUS_SHELL_PATTERNS: Array<{ re: RegExp; code: string; msg: string }> = [
  { re: /\brm\s+-rf?\s+\/(?!\w)/, code: 'shell.rm_root', msg: 'Removes from filesystem root.' },
  { re: /\bdd\b.*\bof=\/dev\//, code: 'shell.dd_device', msg: 'Writes raw bytes to a device node.' },
  { re: /\bmkfs\b/, code: 'shell.mkfs', msg: 'Reformats a filesystem.' },
  { re: /\b(curl|wget)[^|]*\|\s*(bash|sh|zsh)\b/, code: 'shell.pipe_to_shell', msg: 'Pipes a remote download into a shell — full RCE if upstream is compromised.' },
  { re: /\bsudo\b/, code: 'shell.sudo', msg: 'Requests root privilege escalation.' },
  { re: /\bchmod\s+(0?7{3}|a\+w)\b/, code: 'shell.world_writable', msg: 'Makes the target world-writable.' },
  { re: /\beval\s+/, code: 'shell.eval', msg: 'Uses eval — dynamic command construction is a code-injection risk.' },
  { re: /\$\([^)]*\$\{/, code: 'shell.nested_subst', msg: 'Nested substitution with variable expansion — easy to misuse.' },
];

const DANGEROUS_PATH_PREFIXES = ['/', '/etc', '/var', '/usr', '/boot', '/root', '/proc', '/sys'];
const SENSITIVE_HOME_PATHS = ['~', '~/.ssh', '~/.aws', '~/.config', '~/.gnupg'];

const SECRET_PATTERNS: Array<{ re: RegExp; code: string; msg: string }> = [
  { re: /sk-[a-zA-Z0-9]{20,}/, code: 'secret.openai_key', msg: 'Looks like an OpenAI API key.' },
  { re: /AKIA[0-9A-Z]{16}/, code: 'secret.aws_access_key', msg: 'Looks like an AWS access key ID.' },
  { re: /AIza[0-9A-Za-z\-_]{35}/, code: 'secret.google_key', msg: 'Looks like a Google API key.' },
  { re: /xox[baprs]-[0-9a-zA-Z\-]{10,}/, code: 'secret.slack_token', msg: 'Looks like a Slack token.' },
  { re: /ghp_[A-Za-z0-9]{36}/, code: 'secret.github_pat', msg: 'Looks like a GitHub personal access token.' },
  { re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, code: 'secret.private_key', msg: 'Embedded private key.' },
];

const PROMPT_INJECTION_PATTERNS: Array<{ re: RegExp; code: string; msg: string }> = [
  { re: /ignore (all |the )?previous (instructions?|prompts?)/i, code: 'inject.ignore_previous', msg: 'Classic prompt-injection trigger phrase.' },
  { re: /you are now [a-z ]{3,40}/i, code: 'inject.role_override', msg: 'Attempts to override the agent role.' },
  { re: /system:\s/i, code: 'inject.system_role', msg: 'Tries to inject a synthetic system message.' },
  { re: /<\|im_(start|end)\|>/, code: 'inject.chat_template_token', msg: 'Embeds a chat-template control token.' },
  { re: /reveal (your |the )?(system|hidden) prompt/i, code: 'inject.exfil_prompt', msg: 'Attempts to exfiltrate the system prompt.' },
];

export function scanSkill(
  skillType: SkillType,
  config: Record<string, unknown>
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  const command = typeof config.command === 'string' ? config.command : '';
  const url = typeof config.url === 'string' ? config.url : '';
  const content = typeof config.content === 'string' ? config.content : '';
  const paths: string[] = Array.isArray(config.paths) ? (config.paths as unknown[]).filter((p): p is string => typeof p === 'string') : [];
  const readOnly = config.read_only !== false;

  // Secrets — scan every textual field
  const haystacks = [command, url, content, ...paths];
  for (const text of haystacks) {
    if (!text) continue;
    for (const { re, code, msg } of SECRET_PATTERNS) {
      if (re.test(text)) {
        findings.push({ severity: 'critical', code, message: msg });
      }
    }
  }

  if (skillType === 'shell') {
    if (!command) {
      findings.push({ severity: 'critical', code: 'shell.empty_command', message: 'Shell skill must define a command.' });
    } else {
      for (const { re, code, msg } of DANGEROUS_SHELL_PATTERNS) {
        if (re.test(command)) {
          findings.push({ severity: 'critical', code, message: msg });
        }
      }
      if (/\$\{?[A-Z_][A-Z0-9_]*\}?/.test(command)) {
        findings.push({ severity: 'warning', code: 'shell.env_interpolation', message: 'Command interpolates environment variables — verify they are populated safely at runtime.' });
      }
    }
  }

  if (skillType === 'mcp') {
    if (!url) {
      findings.push({ severity: 'critical', code: 'mcp.empty_url', message: 'MCP skill must define a server URL.' });
    } else {
      if (!/^https:\/\//i.test(url)) {
        findings.push({ severity: 'warning', code: 'mcp.insecure_scheme', message: 'MCP server URL is not https — traffic could be intercepted.' });
      }
      if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url)) {
        findings.push({ severity: 'info', code: 'mcp.local_url', message: 'MCP server is local — fine for dev, won\'t reach production agents.' });
      }
    }
  }

  if (skillType === 'prompt_inject') {
    if (!content) {
      findings.push({ severity: 'critical', code: 'prompt.empty', message: 'Prompt-inject skill must have content.' });
    } else {
      for (const { re, code, msg } of PROMPT_INJECTION_PATTERNS) {
        if (re.test(content)) {
          findings.push({ severity: 'critical', code, message: msg });
        }
      }
    }
  }

  if (skillType === 'file_access') {
    if (paths.length === 0) {
      findings.push({ severity: 'critical', code: 'fs.no_paths', message: 'file_access skill must list at least one path.' });
    }
    for (const p of paths) {
      const normalized = p.trim();
      if (DANGEROUS_PATH_PREFIXES.includes(normalized)) {
        findings.push({ severity: 'critical', code: 'fs.system_path', message: `Grants access to system path: ${normalized}` });
      } else if (SENSITIVE_HOME_PATHS.includes(normalized)) {
        findings.push({ severity: 'critical', code: 'fs.sensitive_home', message: `Grants access to sensitive home path: ${normalized}` });
      } else if (normalized === '..' || normalized.startsWith('../')) {
        findings.push({ severity: 'warning', code: 'fs.parent_traversal', message: `Path escapes the project root: ${normalized}` });
      }
      if (!readOnly && (normalized.startsWith('/') || normalized.startsWith('~'))) {
        findings.push({ severity: 'warning', code: 'fs.write_outside_project', message: `Write access to ${normalized} — restrict to read-only unless required.` });
      }
    }
  }

  return dedupe(findings);
}

function dedupe(findings: SecurityFinding[]): SecurityFinding[] {
  const seen = new Set<string>();
  const out: SecurityFinding[] = [];
  for (const f of findings) {
    const key = `${f.severity}:${f.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export function hasCritical(findings: SecurityFinding[]): boolean {
  return findings.some(f => f.severity === 'critical');
}
