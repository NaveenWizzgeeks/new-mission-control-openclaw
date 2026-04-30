'use client';

import { useState } from 'react';
import { FlaskConical, Play, Loader2, CheckCircle2, XCircle, Clock, AlertCircle, FolderOpen } from 'lucide-react';

interface ParsedTest {
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  duration_ms?: number;
  error?: string;
  file?: string;
}

interface ParsedResults {
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  tests: ParsedTest[];
  total: number;
}

interface RunResponse {
  ok: boolean;
  probe?: { cwd: string; installed: boolean; hasConfig: boolean; hasTests: boolean; reason?: string };
  duration_ms?: number;
  exit_code?: number | null;
  results?: ParsedResults;
  stderr?: string | null;
  error?: string;
  code?: string;
}

interface MissionTestsTabProps {
  missionId: string;
  defaultCwd?: string | null;
}

const STATUS_LABEL: Record<ParsedTest['status'], { label: string; cls: string; icon: React.ReactNode }> = {
  passed: { label: 'PASS', cls: 'text-mc-accent-green bg-mc-accent-green/10 border-mc-accent-green/30', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  failed: { label: 'FAIL', cls: 'text-mc-accent-red bg-mc-accent-red/10 border-mc-accent-red/30', icon: <XCircle className="w-3.5 h-3.5" /> },
  skipped: { label: 'SKIP', cls: 'text-mc-text-secondary bg-mc-bg-tertiary border-mc-border', icon: <Clock className="w-3.5 h-3.5" /> },
  timedOut: { label: 'TIMEOUT', cls: 'text-mc-accent-yellow bg-mc-accent-yellow/10 border-mc-accent-yellow/30', icon: <Clock className="w-3.5 h-3.5" /> },
  interrupted: { label: 'INTR', cls: 'text-mc-accent-yellow bg-mc-accent-yellow/10 border-mc-accent-yellow/30', icon: <AlertCircle className="w-3.5 h-3.5" /> },
};

export function MissionTestsTab({ missionId, defaultCwd }: MissionTestsTabProps) {
  const [cwd, setCwd] = useState(defaultCwd ?? '');
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<RunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResponse(null);
    try {
      const body: Record<string, unknown> = {};
      if (cwd.trim()) body.cwd = cwd.trim();
      const res = await fetch(`/api/missions/${missionId}/playwright/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Run failed (${res.status})`);
        setResponse(data);
      } else {
        setResponse(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  };

  const results = response?.results;
  const probe = response?.probe;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
        <div className="flex items-start gap-3 mb-4">
          <FlaskConical className="w-5 h-5 text-mc-accent-yellow mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-mc-text">Playwright Test Results</h3>
            <p className="text-xs text-mc-text-secondary mt-1">
              Runs <code className="font-mono">npx playwright test --reporter=json</code> against the
              target directory and parses pass/fail per test. Output is captured server-side.
            </p>
          </div>
        </div>

        {/* CWD input */}
        <div className="space-y-2 mb-4">
          <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary">
            Working directory <span className="opacity-60 normal-case tracking-normal">— defaults to mission codebase_path or workspace path</span>
          </label>
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-mc-text-secondary shrink-0" />
            <input
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder={defaultCwd ?? '/absolute/path/to/project'}
              className="flex-1 min-h-9 bg-mc-bg border border-mc-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-mc-accent"
            />
          </div>
        </div>

        <button
          onClick={run}
          disabled={running}
          className="flex items-center gap-2 px-4 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90 disabled:opacity-50"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {running ? 'Running…' : 'Run Playwright'}
        </button>

        {error && (
          <div className="mt-3 flex items-start gap-2 text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div>{error}</div>
              {response?.code === 'playwright_missing' && (
                <div className="mt-1 text-[11px] opacity-80">
                  Install with: <code className="font-mono">npx playwright install --with-deps chromium</code> (run inside the project)
                </div>
              )}
            </div>
          </div>
        )}

        {/* Probe info */}
        {probe && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-mc-text-secondary">
            <Pill ok={probe.installed} label="Playwright installed" />
            <Pill ok={probe.hasConfig} label="Config present" />
            <Pill ok={probe.hasTests} label="Test files found" />
          </div>
        )}
      </div>

      {/* Results */}
      {results && (
        <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-mc-text-secondary">Run Summary</h3>
            <span className="text-xs text-mc-text-secondary tabular-nums">
              {(results.duration_ms / 1000).toFixed(1)}s · {results.total} test{results.total === 1 ? '' : 's'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            <Stat label="Passed" value={results.passed} accent="text-mc-accent-green" />
            <Stat label="Failed" value={results.failed} accent="text-mc-accent-red" />
            <Stat label="Skipped" value={results.skipped} accent="text-mc-text-secondary" />
          </div>

          {results.tests.length === 0 ? (
            <p className="text-sm text-mc-text-secondary text-center py-3">No tests reported.</p>
          ) : (
            <ul className="space-y-1.5">
              {results.tests.map((t, i) => {
                const meta = STATUS_LABEL[t.status];
                return (
                  <li key={i} className="px-3 py-2 rounded-lg border border-mc-border bg-mc-bg/40">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wider font-medium shrink-0 ${meta.cls}`}>
                        {meta.icon}
                        {meta.label}
                      </span>
                      <span className="text-sm text-mc-text truncate flex-1">{t.name}</span>
                      {typeof t.duration_ms === 'number' && (
                        <span className="text-[11px] font-mono text-mc-text-secondary tabular-nums shrink-0">
                          {t.duration_ms < 1000 ? `${t.duration_ms}ms` : `${(t.duration_ms / 1000).toFixed(2)}s`}
                        </span>
                      )}
                    </div>
                    {t.file && <p className="mt-1 text-[10px] font-mono text-mc-text-secondary/70 truncate">{t.file}</p>}
                    {t.error && (
                      <pre className="mt-2 text-[11px] font-mono whitespace-pre-wrap text-mc-accent-red/90 bg-mc-accent-red/5 border border-mc-accent-red/20 rounded px-2 py-1.5 max-h-40 overflow-y-auto">
                        {t.error}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {response?.stderr && (
            <details className="mt-3 text-xs">
              <summary className="text-mc-text-secondary cursor-pointer hover:text-mc-text">stderr ({response.stderr.length} chars)</summary>
              <pre className="mt-2 font-mono whitespace-pre-wrap bg-mc-bg p-2 rounded border border-mc-border text-mc-text-secondary max-h-40 overflow-y-auto">{response.stderr}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="bg-mc-bg/40 rounded-lg border border-mc-border p-3 text-center">
      <p className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-mc-text-secondary mt-0.5">{label}</p>
    </div>
  );
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded border ${ok ? 'border-mc-accent-green/30 bg-mc-accent-green/10 text-mc-accent-green' : 'border-mc-border bg-mc-bg-tertiary text-mc-text-secondary'}`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {label}
    </span>
  );
}
