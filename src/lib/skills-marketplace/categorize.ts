/**
 * Heuristic categorizer for ClawHub items.
 *
 * The v1 API doesn't expose categories, so we infer one from summary + tags.
 * Mirrors clawhub.ai's own taxonomy: MCP Tools / Prompts / Workflows /
 * Dev Tools / Data & APIs / Security / Automation / Other (plus channel and
 * memory which are common plugin shapes).
 */

import type { SkillCategory } from './types';

const RX = {
  mcp: /\bmcp\b|model context protocol/i,
  shell: /\bshell\b|\bcli\b|command line|bash script|exec(?:ute|s)?\b/i,
  file: /file system|read(?:s|ing)? files?|write(?:s|ing)? files?|filesystem/i,
  channel: /\b(slack|discord|telegram|whatsapp|webhook|email|gmail|sms|line|teams|nostr|chat channel|voice call|twitch|signal|matrix)\b/i,
  memory: /\b(memory|recall|knowledge graph|embedding|vector store|long-?term memory|episodic|conversation history)\b/i,
  data: /\b(api|database|sql|csv|json|stock|finance|crypto|trading|scrape|scraping|fetch|http)\b/i,
  security: /\b(security|vulnerab|exploit|sandbox|sanitiz|injection|secret|credential)\b/i,
  automation: /\b(automat|cron|schedul|workflow|pipeline|trigger|orchestrat)\b/i,
  devtools: /\b(git|github|docker|kubernetes|k8s|test|debug|lint|deploy|build|compile|typescript|python|node)\b/i,
  prompt: /\b(prompt|persona|system message|guideline|playbook|rubric|methodology|checklist|workflow:)/i,
  github: /\b(github|gitlab|bitbucket)\b/i,
  productivity: /\b(notion|google drive|google docs|gmail|calendar|airtable|todoist|trello)\b/i,
  testing: /\b(playwright|jest|vitest|pytest|test runner|e2e|integration test)\b/i,
};

export function categorizeFromText(...parts: Array<string | undefined>): SkillCategory {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  if (!text) return 'other';

  // Order matters — most specific first.
  if (RX.github.test(text)) return 'github';
  if (RX.testing.test(text)) return 'testing';
  if (RX.security.test(text)) return 'security';
  if (RX.channel.test(text)) return 'channel';
  if (RX.memory.test(text)) return 'memory';
  if (RX.productivity.test(text)) return 'productivity';
  if (RX.devtools.test(text)) return 'dev-tools';
  if (RX.data.test(text)) return 'data';
  if (RX.automation.test(text)) return 'workflow';
  if (RX.prompt.test(text)) return 'methodology';
  return 'other';
}

/** Same heuristic surface but biased toward MCP for plugins. */
export function categorizePlugin(opts: {
  summary?: string;
  family?: string;
  capabilityTags?: string[];
  slug?: string;
}): SkillCategory {
  const text = [opts.summary, opts.slug, (opts.capabilityTags ?? []).join(' ')].filter(Boolean).join(' ');
  return categorizeFromText(text);
}
