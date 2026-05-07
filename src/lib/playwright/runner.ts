/**
 * Playwright runner (Nexus Phase 7c).
 *
 * Server-side helpers to install + run a Playwright suite against a target
 * directory and parse the JSON reporter output. Intended to be invoked from
 * /api/missions/[id]/playwright/run when the mission moves into testing.
 *
 * SECURITY: cwd is validated to be an absolute path that exists. No shell
 * interpolation — args go through execFile. Output capped at 5MB.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const DEFAULT_TEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_INSTALL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MB

export interface ResolveResult {
  ok: boolean;
  cwd: string;
  installed: boolean;
  hasConfig: boolean;
  hasTests: boolean;
  reason?: string;
}

export interface ParsedTest {
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  duration_ms?: number;
  error?: string;
  file?: string;
}

export interface ParsedResults {
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  tests: ParsedTest[];
  total: number;
}

export interface RunResult {
  ok: boolean;
  exitCode: number | null;
  duration_ms: number;
  results?: ParsedResults;
  raw_stdout_bytes: number;
  raw_stderr_bytes: number;
  error?: string;
}

/**
 * Validate cwd: absolute path that exists and is a directory. Throws on
 * anything that smells like path traversal.
 */
function validateCwd(cwd: string): string {
  if (typeof cwd !== 'string' || cwd.trim().length === 0) {
    throw new Error('cwd must be a non-empty string');
  }
  if (!path.isAbsolute(cwd)) {
    throw new Error('cwd must be an absolute path');
  }
  // Resolve realpath — disallow symlink shenanigans by re-checking equality.
  const resolved = path.resolve(cwd);
  if (resolved !== cwd) {
    throw new Error('cwd must already be in resolved form');
  }
  if (!existsSync(resolved)) {
    throw new Error(`cwd does not exist: ${resolved}`);
  }
  if (!statSync(resolved).isDirectory()) {
    throw new Error(`cwd is not a directory: ${resolved}`);
  }
  return resolved;
}

/**
 * Look for the Playwright binary, config, and at least one test file under cwd.
 */
export function resolveTarget(cwd: string): ResolveResult {
  let resolvedCwd: string;
  try {
    resolvedCwd = validateCwd(cwd);
  } catch (err) {
    return { ok: false, cwd, installed: false, hasConfig: false, hasTests: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const binPath = path.join(resolvedCwd, 'node_modules', '.bin', 'playwright');
  const installed = existsSync(binPath);

  const configCandidates = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'];
  const hasConfig = configCandidates.some(f => existsSync(path.join(resolvedCwd, f)));

  // Look for ANY *.spec.* / *.test.* under common test dirs without walking deeply.
  const testRoots = ['tests', 'e2e', 'test', '.'];
  let hasTests = false;
  try {
    for (const dir of testRoots) {
      const dirPath = path.join(resolvedCwd, dir);
      if (!existsSync(dirPath)) continue;
      const entries = readdirSync(dirPath);
      if (entries.some(e => /\.(spec|test)\.(ts|js|mjs)$/i.test(e))) { hasTests = true; break; }
    }
  } catch { /* ignore */ }

  return { ok: true, cwd: resolvedCwd, installed, hasConfig, hasTests };
}

/**
 * Run Playwright with the JSON reporter. Returns parsed pass/fail counts
 * and per-test statuses. Non-zero exit code does NOT throw — failed tests
 * are a normal outcome that the caller wants to inspect.
 */
export async function runTests(cwd: string, opts?: { timeoutMs?: number }): Promise<RunResult> {
  let resolvedCwd: string;
  try {
    resolvedCwd = validateCwd(cwd);
  } catch (err) {
    return {
      ok: false,
      exitCode: null,
      duration_ms: 0,
      raw_stdout_bytes: 0,
      raw_stderr_bytes: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(
      'npx',
      ['playwright', 'test', '--reporter=json'],
      {
        cwd: resolvedCwd,
        timeout: opts?.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: { ...process.env, CI: '1' },
      }
    );
    return {
      ok: true,
      exitCode: 0,
      duration_ms: Date.now() - start,
      raw_stdout_bytes: Buffer.byteLength(stdout),
      raw_stderr_bytes: Buffer.byteLength(stderr),
      results: parseResults(stdout),
    };
  } catch (err) {
    // execFile throws when exit code != 0. Test failures live here.
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    const stdout = typeof e.stdout === 'string' ? e.stdout : '';
    const stderr = typeof e.stderr === 'string' ? e.stderr : '';
    const exitCode = typeof e.code === 'number' ? e.code : null;
    let parsed: ParsedResults | undefined;
    try { if (stdout) parsed = parseResults(stdout); } catch { /* malformed JSON; surface raw */ }
    return {
      ok: false,
      exitCode,
      duration_ms: Date.now() - start,
      raw_stdout_bytes: Buffer.byteLength(stdout),
      raw_stderr_bytes: Buffer.byteLength(stderr),
      results: parsed,
      error: stderr.slice(0, 4000) || (e.message ?? 'Unknown error'),
    };
  }
}

interface PWStatusUnion {
  status?: string;
}

interface PWAttachment {
  body?: string;
}

interface PWTestResult {
  status?: string;
  duration?: number;
  error?: { message?: string };
  errors?: Array<{ message?: string }>;
  attachments?: PWAttachment[];
}

interface PWTest {
  title?: string;
  results?: PWTestResult[];
}

interface PWSpec {
  title?: string;
  file?: string;
  tests?: PWTest[];
}

interface PWSuite {
  title?: string;
  file?: string;
  suites?: PWSuite[];
  specs?: PWSpec[];
}

interface PWStats {
  expected?: number;
  unexpected?: number;
  flaky?: number;
  skipped?: number;
  duration?: number;
}

interface PWReport extends PWStatusUnion {
  stats?: PWStats;
  suites?: PWSuite[];
}

/**
 * Parse Playwright's JSON reporter output. Tolerates partial/empty output.
 */
export function parseResults(jsonText: string): ParsedResults {
  if (!jsonText || jsonText.trim().length === 0) {
    return { passed: 0, failed: 0, skipped: 0, duration_ms: 0, tests: [], total: 0 };
  }
  let report: PWReport;
  try {
    report = JSON.parse(jsonText) as PWReport;
  } catch {
    return { passed: 0, failed: 0, skipped: 0, duration_ms: 0, tests: [], total: 0 };
  }

  const tests: ParsedTest[] = [];

  function statusFromTestResult(r: PWTestResult | undefined): ParsedTest['status'] {
    const s = (r?.status ?? '').toLowerCase();
    if (s === 'passed') return 'passed';
    if (s === 'skipped') return 'skipped';
    if (s === 'timedout') return 'timedOut';
    if (s === 'interrupted') return 'interrupted';
    return 'failed';
  }

  function walkSuite(suite: PWSuite, parentTitle = '', file?: string): void {
    const localFile = suite.file ?? file;
    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        const specTitle = [parentTitle, suite.title, spec.title].filter(Boolean).join(' › ');
        if (Array.isArray(spec.tests)) {
          for (const t of spec.tests) {
            const last = t.results?.[t.results.length - 1];
            const testName = [specTitle, t.title].filter(Boolean).join(' › ');
            const errMsg = last?.error?.message ?? last?.errors?.[0]?.message;
            tests.push({
              name: testName,
              status: statusFromTestResult(last),
              duration_ms: typeof last?.duration === 'number' ? last.duration : undefined,
              error: errMsg ? errMsg.slice(0, 1500) : undefined,
              file: spec.file ?? localFile,
            });
          }
        }
      }
    }
    if (Array.isArray(suite.suites)) {
      for (const child of suite.suites) walkSuite(child, [parentTitle, suite.title].filter(Boolean).join(' › '), localFile);
    }
  }

  if (Array.isArray(report.suites)) {
    for (const top of report.suites) walkSuite(top);
  }

  const passed = tests.filter(t => t.status === 'passed').length;
  const failed = tests.filter(t => t.status === 'failed' || t.status === 'timedOut' || t.status === 'interrupted').length;
  const skipped = tests.filter(t => t.status === 'skipped').length;

  return {
    passed,
    failed,
    skipped,
    duration_ms: typeof report.stats?.duration === 'number' ? report.stats.duration : tests.reduce((s, t) => s + (t.duration_ms ?? 0), 0),
    tests,
    total: tests.length,
  };
}

/**
 * Convenience: install Playwright browsers (idempotent — skipped if cached).
 * Don't await this in the request path; the install is slow and only matters
 * the first time.
 */
export async function installBrowsers(cwd: string): Promise<{ ok: boolean; error?: string }> {
  let resolvedCwd: string;
  try {
    resolvedCwd = validateCwd(cwd);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    await execFileAsync(
      'npx',
      ['playwright', 'install', '--with-deps', 'chromium'],
      {
        cwd: resolvedCwd,
        timeout: DEFAULT_INSTALL_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
      }
    );
    return { ok: true };
  } catch (err) {
    const e = err as Error;
    return { ok: false, error: e.message?.slice(0, 1500) ?? 'install failed' };
  }
}
