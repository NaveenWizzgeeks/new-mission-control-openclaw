/**
 * Per-agent skills (Nexus Phase 7).
 *
 * Skills are scoped to the agent — they follow the agent into any mission or
 * workspace. At dispatch time we load enabled skills for an agent and merge
 * them into the spawn config so the agent receives:
 *   - shell allowed_tools
 *   - mcp_servers
 *   - prompt_inject system_prompt suffix
 *   - file_access allowlist
 *
 * Skill rows live in `agent_skills`. skill_config is a JSON blob whose shape
 * depends on skill_type (see Skill subtypes below).
 */

import { queryAll } from '@/lib/db';

export type SkillType = 'shell' | 'mcp' | 'prompt_inject' | 'file_access';

export interface SkillRow {
  id: string;
  agent_id: string;
  skill_type: SkillType;
  skill_name: string;
  skill_config: string; // JSON
  enabled: number; // 0 | 1
  created_at: string;
}

// Strongly-typed configs (parsed from skill_config JSON).
export interface ShellSkillConfig { command: string; description?: string }
export interface McpSkillConfig { url: string; name?: string }
export interface PromptInjectSkillConfig { content: string }
export interface FileAccessSkillConfig { paths: string[]; read_only?: boolean }

export interface ParsedSkill {
  id: string;
  type: SkillType;
  name: string;
  config: ShellSkillConfig | McpSkillConfig | PromptInjectSkillConfig | FileAccessSkillConfig | Record<string, unknown>;
}

/** What the dispatch code injects into. Keeping this minimal so we can grow it. */
export interface AgentSpawnConfig {
  system_prompt?: string;
  allowed_tools?: Array<{ type: 'shell'; name: string; command: string; description?: string }>;
  mcp_servers?: Array<{ type: 'url'; name: string; url: string }>;
  file_access_allowlist?: Array<{ path: string; read_only: boolean }>;
}

export function loadSkillsForAgent(agentId: string): ParsedSkill[] {
  const rows = queryAll<SkillRow>(
    `SELECT id, agent_id, skill_type, skill_name, skill_config, enabled, created_at
     FROM agent_skills WHERE agent_id = ? AND enabled = 1
     ORDER BY skill_type, skill_name`,
    [agentId]
  );
  return rows.map(r => ({
    id: r.id,
    type: r.skill_type,
    name: r.skill_name,
    config: safeParseConfig(r.skill_config),
  }));
}

function safeParseConfig(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

/**
 * Merge skills into an existing spawn config. Pure function — does not mutate
 * the input. Idempotent against the same skill set.
 */
export function injectSkills(base: AgentSpawnConfig, skills: ParsedSkill[]): AgentSpawnConfig {
  const out: AgentSpawnConfig = {
    system_prompt: base.system_prompt ?? '',
    allowed_tools: [...(base.allowed_tools ?? [])],
    mcp_servers: [...(base.mcp_servers ?? [])],
    file_access_allowlist: [...(base.file_access_allowlist ?? [])],
  };

  // Track names already present so reapplying skills doesn't duplicate them.
  const toolNames = new Set(out.allowed_tools!.map(t => t.name));
  const mcpNames = new Set(out.mcp_servers!.map(m => m.name));
  const filePaths = new Set(out.file_access_allowlist!.map(f => f.path));
  const promptInjects: string[] = [];

  for (const s of skills) {
    switch (s.type) {
      case 'shell': {
        const cfg = s.config as ShellSkillConfig;
        if (!cfg.command || toolNames.has(s.name)) break;
        out.allowed_tools!.push({ type: 'shell', name: s.name, command: cfg.command, description: cfg.description });
        toolNames.add(s.name);
        break;
      }
      case 'mcp': {
        const cfg = s.config as McpSkillConfig;
        if (!cfg.url || mcpNames.has(cfg.name ?? s.name)) break;
        out.mcp_servers!.push({ type: 'url', name: cfg.name ?? s.name, url: cfg.url });
        mcpNames.add(cfg.name ?? s.name);
        break;
      }
      case 'prompt_inject': {
        const cfg = s.config as PromptInjectSkillConfig;
        if (cfg.content && cfg.content.trim().length > 0) {
          promptInjects.push(`### ${s.name}\n${cfg.content.trim()}`);
        }
        break;
      }
      case 'file_access': {
        const cfg = s.config as FileAccessSkillConfig;
        if (!Array.isArray(cfg.paths)) break;
        for (const p of cfg.paths) {
          if (filePaths.has(p)) continue;
          out.file_access_allowlist!.push({ path: p, read_only: cfg.read_only !== false });
          filePaths.add(p);
        }
        break;
      }
    }
  }

  if (promptInjects.length > 0) {
    const sep = (out.system_prompt && out.system_prompt.length > 0) ? '\n\n---\n\n' : '';
    out.system_prompt = `${out.system_prompt}${sep}## Skills\n\n${promptInjects.join('\n\n')}`;
  }

  return out;
}

/**
 * Convenience: serialize a spawn config into a string suitable for appending
 * to a chat.send message. Used when the dispatch path doesn't have a
 * structured spawn config and just sends a prompt to the agent's session.
 */
export function skillsToPromptSuffix(skills: ParsedSkill[]): string {
  if (skills.length === 0) return '';
  const blocks: string[] = [];

  const shell = skills.filter(s => s.type === 'shell') as Array<ParsedSkill & { config: ShellSkillConfig }>;
  if (shell.length > 0) {
    blocks.push(
      '### Available shell tools\n' +
      shell.map(s => `- **${s.name}** — \`${s.config.command}\`${s.config.description ? `\n  ${s.config.description}` : ''}`).join('\n')
    );
  }

  const mcp = skills.filter(s => s.type === 'mcp') as Array<ParsedSkill & { config: McpSkillConfig }>;
  if (mcp.length > 0) {
    blocks.push(
      '### MCP servers\n' +
      mcp.map(s => `- **${(s.config.name ?? s.name)}** at ${s.config.url}`).join('\n')
    );
  }

  const fa = skills.filter(s => s.type === 'file_access') as Array<ParsedSkill & { config: FileAccessSkillConfig }>;
  if (fa.length > 0) {
    blocks.push(
      '### File access\n' +
      fa.map(s => {
        const paths = (s.config.paths || []).join(', ');
        const mode = s.config.read_only === false ? 'read+write' : 'read-only';
        return `- **${s.name}** (${mode}): ${paths}`;
      }).join('\n')
    );
  }

  const inj = skills.filter(s => s.type === 'prompt_inject') as Array<ParsedSkill & { config: PromptInjectSkillConfig }>;
  if (inj.length > 0) {
    blocks.push(inj.map(s => `### ${s.name}\n${s.config.content}`).join('\n\n'));
  }

  return `\n\n---\n\n## Skills\n\n${blocks.join('\n\n')}\n`;
}
