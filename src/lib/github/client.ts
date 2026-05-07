/**
 * Thin GitHub REST API wrapper.
 *
 * No octokit dep — this codebase already uses fetch. We only need
 * issues create/update/get and a label list. PAT auth via Authorization header.
 */

const BASE = 'https://api.github.com';
const UA = 'mission-control/0.13';

export interface GitHubIssue {
  number: number;
  state: 'open' | 'closed';
  title: string;
  body: string | null;
  labels: Array<{ name: string }>;
  html_url: string;
  updated_at: string;
}

export class GitHubError extends Error {
  constructor(public readonly status: number, public readonly body: string, msg?: string) {
    super(msg ?? `GitHub API ${status}: ${body.slice(0, 200)}`);
  }
}

export class GitHubClient {
  constructor(private readonly token: string, private readonly owner: string, private readonly repo: string) {
    if (!token) throw new Error('GitHub token required');
    if (!owner || !repo) throw new Error('owner and repo required');
  }

  private async request<T>(path: string, init?: RequestInit & { etag?: string }): Promise<{ data: T; etag: string | null; status: number }> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': UA,
    };
    if (init?.etag) headers['if-none-match'] = init.etag;
    if (init?.body) headers['content-type'] = 'application/json';

    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string> ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 304) {
      return { data: undefined as unknown as T, etag: res.headers.get('etag'), status: 304 };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new GitHubError(res.status, body);
    }
    const data = (await res.json()) as T;
    return { data, etag: res.headers.get('etag'), status: res.status };
  }

  async createIssue(args: { title: string; body?: string; labels?: string[] }): Promise<GitHubIssue> {
    const { data } = await this.request<GitHubIssue>(
      `/repos/${this.owner}/${this.repo}/issues`,
      { method: 'POST', body: JSON.stringify({ title: args.title, body: args.body, labels: args.labels ?? [] }) },
    );
    return data;
  }

  async updateIssue(issueNumber: number, args: { title?: string; body?: string; state?: 'open' | 'closed'; labels?: string[] }): Promise<GitHubIssue> {
    const { data } = await this.request<GitHubIssue>(
      `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`,
      { method: 'PATCH', body: JSON.stringify(args) },
    );
    return data;
  }

  async getIssue(issueNumber: number, etag?: string): Promise<{ issue: GitHubIssue | null; etag: string | null; not_modified: boolean }> {
    const r = await this.request<GitHubIssue>(
      `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`,
      { etag },
    );
    if (r.status === 304) return { issue: null, etag: r.etag, not_modified: true };
    return { issue: r.data, etag: r.etag, not_modified: false };
  }

  async ping(): Promise<{ ok: boolean; login?: string; rate_remaining?: number }> {
    try {
      const res = await fetch(`${BASE}/user`, {
        headers: { authorization: `Bearer ${this.token}`, accept: 'application/vnd.github+json', 'user-agent': UA },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return { ok: false };
      const j = await res.json() as { login?: string };
      return {
        ok: true,
        login: j.login,
        rate_remaining: Number(res.headers.get('x-ratelimit-remaining') ?? '0'),
      };
    } catch {
      return { ok: false };
    }
  }
}
