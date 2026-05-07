import type { MarketplaceSkill } from './types';

/**
 * Curated catalog of locally-known skills.
 *
 * Coexists with the live ClawHub registry (src/lib/skills-marketplace/clawhub.ts).
 * The local catalog is the fallback when ClawHub is unreachable, and the
 * source for the few preview plugins (notion/google/slack) that don't have
 * real ClawHub entries yet.
 *
 * Catalog rows omit `source`/`kind` — the accessor functions fill them in so
 * we don't repeat `source: 'local', kind: 'skill'` on every row.
 */
type CatalogRow = Omit<MarketplaceSkill, 'source' | 'kind'>;

const RAW_CATALOG: CatalogRow[] = [
  {
    slug: 'git-diff',
    name: 'Git Diff',
    short_description: 'Inspect unstaged changes in the working tree.',
    readme:
      'Grants the agent access to `git diff`. Useful for code review, change summarization, and PR description drafting. ' +
      'No network access; reads from the workspace git index only.',
    author: 'autensa-core',
    version: '1.0.0',
    category: 'github',
    tags: ['git', 'review', 'diff'],
    rating: 4.9,
    rating_count: 312,
    installs: 8421,
    updated_at: '2026-04-12',
    install_template: {
      skill_type: 'shell',
      skill_name: 'git_diff',
      skill_config: { command: 'git diff', description: 'Show unstaged changes.' },
    },
  },
  {
    slug: 'git-log',
    name: 'Git Log (recent)',
    short_description: 'Show the last 20 commits with one-line summary.',
    readme: 'Lets the agent read recent commit history to understand context before making changes.',
    author: 'autensa-core',
    version: '1.0.0',
    category: 'github',
    tags: ['git', 'history'],
    rating: 4.8,
    rating_count: 211,
    installs: 6101,
    updated_at: '2026-04-12',
    install_template: {
      skill_type: 'shell',
      skill_name: 'git_log_recent',
      skill_config: { command: 'git log --oneline -20', description: 'Last 20 commits, one line each.' },
    },
  },
  {
    slug: 'playwright-test',
    name: 'Playwright Test Runner',
    short_description: 'Run end-to-end browser tests with Playwright.',
    readme:
      'Adds the `npx playwright test` runner so the agent can verify UI work end-to-end. ' +
      'Pair with the `web_search` skill to let the agent debug failures by reading docs.',
    author: 'autensa-core',
    version: '1.2.0',
    category: 'testing',
    tags: ['e2e', 'browser', 'qa'],
    rating: 4.7,
    rating_count: 187,
    installs: 4214,
    updated_at: '2026-04-08',
    install_template: {
      skill_type: 'shell',
      skill_name: 'playwright_test',
      skill_config: { command: 'npx playwright test', description: 'Run the Playwright test suite.' },
    },
  },
  {
    slug: 'npm-test',
    name: 'NPM Test',
    short_description: 'Run the project\'s npm test script.',
    readme: 'Standard `npm test` runner. Works with any package.json that defines a `test` script.',
    author: 'autensa-core',
    version: '1.0.0',
    category: 'testing',
    tags: ['unit', 'ci'],
    rating: 4.6,
    rating_count: 401,
    installs: 9322,
    updated_at: '2026-03-30',
    install_template: {
      skill_type: 'shell',
      skill_name: 'npm_test',
      skill_config: { command: 'npm test', description: 'Run the project test suite.' },
    },
  },
  {
    slug: 'tsc-check',
    name: 'TypeScript Check',
    short_description: 'Type-check the project without emitting output.',
    readme: 'Runs `npx tsc --noEmit` so the agent can self-verify type safety before declaring a task done.',
    author: 'autensa-core',
    version: '1.0.0',
    category: 'dev-tools',
    tags: ['typescript', 'types', 'verify'],
    rating: 4.8,
    rating_count: 264,
    installs: 5821,
    updated_at: '2026-04-01',
    install_template: {
      skill_type: 'shell',
      skill_name: 'tsc_check',
      skill_config: { command: 'npx tsc --noEmit', description: 'Type-check without emit.' },
    },
  },
  {
    slug: 'kubectl-get',
    name: 'kubectl get',
    short_description: 'Read-only Kubernetes resource inspection.',
    readme: 'Allows the agent to list pods, deployments, services, and other k8s resources. Read-only; no apply/delete.',
    author: 'autensa-cloud',
    version: '0.9.0',
    category: 'cloud',
    tags: ['kubernetes', 'ops'],
    rating: 4.4,
    rating_count: 92,
    installs: 1844,
    updated_at: '2026-03-22',
    install_template: {
      skill_type: 'shell',
      skill_name: 'kubectl_get',
      skill_config: { command: 'kubectl get', description: 'Inspect k8s resources (read-only).' },
    },
  },
  {
    slug: 'aws-s3-ls',
    name: 'AWS S3 list',
    short_description: 'List S3 buckets and objects (read-only).',
    readme: 'Wraps `aws s3 ls`. Requires the host to have AWS credentials configured.',
    author: 'autensa-cloud',
    version: '0.9.0',
    category: 'cloud',
    tags: ['aws', 's3', 'ops'],
    rating: 4.3,
    rating_count: 64,
    installs: 1119,
    updated_at: '2026-03-22',
    install_template: {
      skill_type: 'shell',
      skill_name: 'aws_s3_ls',
      skill_config: { command: 'aws s3 ls', description: 'List S3 buckets and objects.' },
    },
  },
  {
    slug: 'github-mcp',
    name: 'GitHub MCP',
    short_description: 'Issues, PRs, and repo metadata via the GitHub MCP server.',
    readme:
      'Connects the agent to GitHub through the MCP protocol. Allows reading issues, PRs, comments, ' +
      'and creating new ones. Configure auth via the `GITHUB_TOKEN` env on the MCP host.',
    author: 'mcp-community',
    version: '0.4.1',
    category: 'github',
    tags: ['mcp', 'github', 'pr', 'issues'],
    rating: 4.5,
    rating_count: 142,
    installs: 2317,
    updated_at: '2026-04-18',
    install_template: {
      skill_type: 'mcp',
      skill_name: 'github',
      skill_config: { url: 'https://mcp.github.dev', name: 'github' },
    },
  },
  {
    slug: 'web-search-mcp',
    name: 'Web Search MCP',
    short_description: 'Lets the agent search the web for fresh information.',
    readme: 'Connects the agent to a web-search MCP server. Useful for documentation lookup and fact-checking.',
    author: 'mcp-community',
    version: '0.3.0',
    category: 'productivity',
    tags: ['mcp', 'search', 'web'],
    rating: 4.6,
    rating_count: 198,
    installs: 3942,
    updated_at: '2026-04-15',
    install_template: {
      skill_type: 'mcp',
      skill_name: 'web_search',
      skill_config: { url: 'https://mcp.search.dev', name: 'web_search' },
    },
  },
  {
    slug: 'notion-mcp',
    name: 'Notion MCP (preview)',
    short_description: 'Read & write Notion pages and databases.',
    readme:
      '**Preview.** Lets the agent query Notion databases and create/update pages. Requires a Notion ' +
      'integration token configured in the autensa credential vault (Phase 14). Until then, the agent ' +
      'can list resources but write operations queue for approval.',
    author: 'autensa-plugins',
    version: '0.1.0',
    category: 'productivity',
    tags: ['mcp', 'notion', 'plugin', 'preview'],
    rating: 4.2,
    rating_count: 38,
    installs: 412,
    updated_at: '2026-04-28',
    install_template: {
      skill_type: 'mcp',
      skill_name: 'notion',
      skill_config: { url: 'https://mcp.autensa.local/notion', name: 'notion' },
    },
  },
  {
    slug: 'google-mcp',
    name: 'Google Workspace MCP (preview)',
    short_description: 'Gmail, Drive, and Calendar via one MCP server.',
    readme:
      '**Preview.** Lets the agent triage Gmail, manage Drive files, and book Calendar events. ' +
      'Requires Google OAuth tokens in the autensa credential vault (Phase 14). Replies and Drive ' +
      'writes route through the approval queue by default.',
    author: 'autensa-plugins',
    version: '0.1.0',
    category: 'productivity',
    tags: ['mcp', 'google', 'gmail', 'drive', 'plugin', 'preview'],
    rating: 4.4,
    rating_count: 27,
    installs: 318,
    updated_at: '2026-04-29',
    install_template: {
      skill_type: 'mcp',
      skill_name: 'google_workspace',
      skill_config: { url: 'https://mcp.autensa.local/google', name: 'google_workspace' },
    },
  },
  {
    slug: 'slack-mcp',
    name: 'Slack MCP (preview)',
    short_description: 'Read channels, send messages, react to threads.',
    readme:
      '**Preview.** Connects the agent to Slack via MCP. Requires a bot token in the autensa ' +
      'credential vault (Phase 14). Outbound messages route through the approval queue by default.',
    author: 'autensa-plugins',
    version: '0.1.0',
    category: 'communication',
    tags: ['mcp', 'slack', 'plugin', 'preview'],
    rating: 4.3,
    rating_count: 19,
    installs: 211,
    updated_at: '2026-04-29',
    install_template: {
      skill_type: 'mcp',
      skill_name: 'slack',
      skill_config: { url: 'https://mcp.autensa.local/slack', name: 'slack' },
    },
  },
  {
    slug: 'project-read-only',
    name: 'Project Read-Only File Access',
    short_description: 'Read access to ./src and ./docs.',
    readme: 'Grants the agent read-only access to the source tree and docs. Safe default for review-style agents.',
    author: 'autensa-core',
    version: '1.0.0',
    category: 'dev-tools',
    tags: ['files', 'read-only'],
    rating: 4.7,
    rating_count: 102,
    installs: 2210,
    updated_at: '2026-03-30',
    install_template: {
      skill_type: 'file_access',
      skill_name: 'project_read',
      skill_config: { paths: ['./src', './docs'], read_only: true },
    },
  },
  {
    slug: 'tdd-methodology',
    name: 'TDD Methodology',
    short_description: 'Inject a test-first workflow into the agent\'s system prompt.',
    readme: 'A short prompt fragment that nudges the agent to write tests before implementation.',
    author: 'autensa-personas',
    version: '1.0.0',
    category: 'methodology',
    tags: ['tdd', 'tests', 'workflow'],
    rating: 4.5,
    rating_count: 78,
    installs: 1620,
    updated_at: '2026-04-02',
    install_template: {
      skill_type: 'prompt_inject',
      skill_name: 'tdd_workflow',
      skill_config: {
        content:
          'You follow test-first development. Before changing implementation code, ' +
          'write or update a test that captures the new behavior, run it (it should fail), ' +
          'then implement the minimum code to make it pass, then refactor.',
      },
    },
  },
  {
    slug: 'code-review-checklist',
    name: 'Code Review Checklist',
    short_description: 'Inject a senior-engineer review checklist.',
    readme: 'Adds a concise review rubric: correctness, security, performance, readability, test coverage.',
    author: 'autensa-personas',
    version: '1.0.0',
    category: 'methodology',
    tags: ['review', 'quality'],
    rating: 4.6,
    rating_count: 121,
    installs: 2104,
    updated_at: '2026-04-02',
    install_template: {
      skill_type: 'prompt_inject',
      skill_name: 'review_checklist',
      skill_config: {
        content:
          'When reviewing code, check: correctness against stated requirements, security ' +
          '(input validation, authz, secrets), performance (allocations, query patterns), ' +
          'readability (naming, function length, comments only where the WHY is non-obvious), ' +
          'and test coverage for the changed paths.',
      },
    },
  },
  {
    slug: 'architect-persona',
    name: 'Software Architect Persona',
    short_description: 'Inject an architect-level mindset for design decisions.',
    readme: 'Tunes the agent to weigh trade-offs explicitly and call out alternatives before committing.',
    author: 'autensa-personas',
    version: '1.0.0',
    category: 'persona',
    tags: ['architect', 'design'],
    rating: 4.4,
    rating_count: 64,
    installs: 1182,
    updated_at: '2026-04-02',
    install_template: {
      skill_type: 'prompt_inject',
      skill_name: 'architect_persona',
      skill_config: {
        content:
          'Operate as a senior software architect. For non-trivial design choices, list two or ' +
          'three viable approaches with their trade-offs (complexity, performance, future-flexibility), ' +
          'recommend one, and proceed only after the user confirms or after explicit autonomous authority.',
      },
    },
  },
  {
    slug: 'security-reviewer-persona',
    name: 'Security Reviewer Persona',
    short_description: 'Adversarial-thinking persona for security review.',
    readme: 'Pushes the agent to assume hostile input and audit for OWASP-style classes of bugs.',
    author: 'autensa-personas',
    version: '1.0.0',
    category: 'security',
    tags: ['security', 'review', 'persona'],
    rating: 4.7,
    rating_count: 51,
    installs: 967,
    updated_at: '2026-04-04',
    install_template: {
      skill_type: 'prompt_inject',
      skill_name: 'security_reviewer',
      skill_config: {
        content:
          'Review every code change as an adversary. Assume input is hostile. Look for: SQL/command ' +
          'injection, XSS, SSRF, authn/authz gaps, insecure deserialization, hardcoded secrets, ' +
          'and unsafe defaults. Surface findings with severity (critical/warning/info) and a concrete fix.',
      },
    },
  },
];

export const CATALOG: MarketplaceSkill[] = RAW_CATALOG.map(r => ({
  ...r,
  source: 'local',
  kind: 'skill',
}));

export function listLocal(opts?: { q?: string; category?: string; tag?: string }): MarketplaceSkill[] {
  let out = CATALOG;
  if (opts?.category) out = out.filter(s => s.category === opts.category);
  if (opts?.tag) out = out.filter(s => s.tags.includes(opts.tag!));
  if (opts?.q) {
    const q = opts.q.toLowerCase();
    out = out.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.short_description.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q)) ||
      s.author.toLowerCase().includes(q)
    );
  }
  return [...out].sort((a, b) => b.installs - a.installs);
}

export function getLocalSkill(slug: string): MarketplaceSkill | null {
  return CATALOG.find(s => s.slug === slug) ?? null;
}

export function listLocalCategories(): string[] {
  return Array.from(new Set(CATALOG.map(s => s.category))).sort();
}

export function listTags(): string[] {
  return Array.from(new Set(CATALOG.flatMap(s => s.tags))).sort();
}
