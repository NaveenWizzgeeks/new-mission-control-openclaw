'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Shield, ShieldCheck, ShieldAlert, ShieldX, Loader2, RefreshCw, CheckCircle2, Info,
  AlertCircle, User, Filter,
} from 'lucide-react';

type Severity = 'critical' | 'warning' | 'info';
type FindingSource = 'chat_inbound' | 'chat_outbound' | 'mcp_call' | 'skill_install';

interface Finding {
  id: string;
  agent_id: string | null;
  agent_name: string | null;
  agent_role: string | null;
  session_id: string | null;
  source: FindingSource;
  severity: Severity;
  code: string;
  message: string;
  evidence: string | null;
  resolved: number;
  resolved_at: string | null;
  created_at: string;
}

interface TrustItem {
  agent_id: string;
  agent_name: string | null;
  score: number;
  band: 'high' | 'medium' | 'low';
  recent_critical: number;
  recent_warning: number;
  recent_info: number;
  total_findings: number;
}

const SOURCE_LABEL: Record<FindingSource, string> = {
  chat_inbound: 'Inbound chat',
  chat_outbound: 'Outbound chat',
  mcp_call: 'MCP call',
  skill_install: 'Skill install',
};

export function SecurityDashboard() {
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [trust, setTrust] = useState<TrustItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [source, setSource] = useState<FindingSource | ''>('');
  const [showResolved, setShowResolved] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (severity) params.set('severity', severity);
      if (source) params.set('source', source);
      params.set('resolved', showResolved ? 'true' : 'false');
      const [fRes, tRes] = await Promise.all([
        fetch(`/api/security/findings?${params.toString()}`),
        fetch('/api/security/trust'),
      ]);
      if (!fRes.ok) {
        setError(`Findings load failed (${fRes.status})`);
        return;
      }
      const fData = await fRes.json();
      setFindings(fData.items);
      if (tRes.ok) {
        const tData = await tRes.json();
        setTrust(tData.items);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [severity, source, showResolved]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/security/findings/${id}/resolve`, { method: 'PATCH' });
      if (res.ok) await load();
    } finally { setBusyId(null); }
  };

  const counts = computeCounts(findings ?? []);
  const lowestTrust = (trust ?? []).filter(t => t.total_findings > 0).sort((a, b) => a.score - b.score);

  return (
    <>
      {/* Header */}
      <div className="border-b border-mc-border bg-mc-bg-secondary px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-mc-accent-green">
            <Shield className="w-5 h-5" />
            <h1 className="text-lg font-semibold text-mc-text">Security</h1>
          </div>
          <span className="text-xs text-mc-text-secondary">
            Findings from chat scanning, MCP calls, and skill installs · per-agent trust score.
          </span>
          <button
            onClick={load}
            className="ml-auto flex items-center gap-1.5 px-2.5 min-h-9 rounded-lg border border-mc-border bg-mc-bg text-xs text-mc-text-secondary hover:text-mc-text"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Counters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          <Counter
            label="Critical"
            value={counts.critical}
            icon={<ShieldX className="w-4 h-4" />}
            tone="red"
            onClick={() => { setSeverity('critical'); setShowResolved(false); }}
          />
          <Counter
            label="Warning"
            value={counts.warning}
            icon={<ShieldAlert className="w-4 h-4" />}
            tone="yellow"
            onClick={() => { setSeverity('warning'); setShowResolved(false); }}
          />
          <Counter
            label="Info"
            value={counts.info}
            icon={<Info className="w-4 h-4" />}
            tone="blue"
            onClick={() => { setSeverity('info'); setShowResolved(false); }}
          />
          <Counter
            label="Resolved"
            value={counts.resolved}
            icon={<ShieldCheck className="w-4 h-4" />}
            tone="green"
            onClick={() => { setSeverity(''); setShowResolved(true); }}
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mt-3 text-xs">
          <Filter className="w-3.5 h-3.5 text-mc-text-secondary" />
          <select
            value={severity}
            onChange={e => setSeverity(e.target.value as Severity | '')}
            className="min-h-9 px-2 rounded-lg bg-mc-bg border border-mc-border focus:outline-none focus:border-mc-accent"
          >
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
          <select
            value={source}
            onChange={e => setSource(e.target.value as FindingSource | '')}
            className="min-h-9 px-2 rounded-lg bg-mc-bg border border-mc-border focus:outline-none focus:border-mc-accent"
          >
            <option value="">All sources</option>
            <option value="chat_inbound">Inbound chat</option>
            <option value="chat_outbound">Outbound chat</option>
            <option value="mcp_call">MCP call</option>
            <option value="skill_install">Skill install</option>
          </select>
          <label className="flex items-center gap-1.5 text-mc-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={e => setShowResolved(e.target.checked)}
            />
            Show resolved
          </label>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-5">
        {/* Findings list */}
        <section>
          <h2 className="text-xs uppercase tracking-wider text-mc-text-secondary mb-2">
            Findings {findings ? `(${findings.length})` : ''}
          </h2>

          {error && (
            <div className="text-sm text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2 mb-4">
              {error}
            </div>
          )}

          {!findings && !error && (
            <div className="flex items-center gap-2 text-sm text-mc-text-secondary py-12 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}

          {findings && findings.length === 0 && (
            <div className="text-center text-sm text-mc-text-secondary py-12 border border-dashed border-mc-border rounded-lg">
              {showResolved ? 'No resolved findings.' : 'No active findings — clean slate.'}
            </div>
          )}

          {findings && findings.length > 0 && (
            <ul className="space-y-2">
              {findings.map(f => (
                <li key={f.id}>
                  <FindingCard finding={f} busy={busyId === f.id} onResolve={() => resolve(f.id)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Trust score sidebar */}
        <aside>
          <h2 className="text-xs uppercase tracking-wider text-mc-text-secondary mb-2">
            Trust scores
          </h2>
          <div className="rounded-lg border border-mc-border bg-mc-bg-secondary p-3">
            {!trust && <p className="text-xs text-mc-text-secondary">Loading…</p>}
            {trust && trust.length === 0 && (
              <p className="text-xs text-mc-text-secondary">No agents.</p>
            )}
            {trust && trust.length > 0 && (
              <ul className="space-y-2">
                {[...trust]
                  .sort((a, b) => a.score - b.score)
                  .slice(0, 10)
                  .map(t => (
                    <li key={t.agent_id} className="flex items-center gap-2 text-xs">
                      <User className="w-3.5 h-3.5 text-mc-text-secondary shrink-0" />
                      <span className="flex-1 truncate text-mc-text">{t.agent_name ?? t.agent_id.slice(0, 8)}</span>
                      <TrustBadge score={t.score} band={t.band} />
                    </li>
                  ))}
                {lowestTrust.length === 0 && (
                  <li className="text-xs text-mc-text-secondary text-center py-2">
                    All agents at 100. No findings to dock anyone.
                  </li>
                )}
              </ul>
            )}
          </div>
          <p className="text-[10px] text-mc-text-secondary mt-2 leading-snug">
            Score = 100 − weighted findings (critical: −20, warning: −5, info: −1) with time decay
            (half-life 14d / 7d / 3d). Resolved findings count at half weight.
          </p>
        </aside>
      </div>
    </>
  );
}

function Counter({
  label, value, icon, tone, onClick,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'red' | 'yellow' | 'blue' | 'green';
  onClick?: () => void;
}) {
  const palette = {
    red: 'border-mc-accent-red/40 bg-mc-accent-red/10 text-mc-accent-red',
    yellow: 'border-mc-accent-yellow/40 bg-mc-accent-yellow/10 text-mc-accent-yellow',
    blue: 'border-mc-accent-blue/40 bg-mc-accent-blue/10 text-mc-accent-blue',
    green: 'border-mc-accent-green/40 bg-mc-accent-green/10 text-mc-accent-green',
  }[tone];
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${palette} text-left transition-colors hover:opacity-90`}
    >
      {icon}
      <div>
        <div className="text-xl font-bold leading-none">{value}</div>
        <div className="text-[10px] uppercase tracking-wider mt-1 opacity-90">{label}</div>
      </div>
    </button>
  );
}

function TrustBadge({ score, band }: { score: number; band: 'high' | 'medium' | 'low' }) {
  const palette =
    band === 'high'
      ? 'bg-mc-accent-green/15 text-mc-accent-green border-mc-accent-green/40'
      : band === 'medium'
      ? 'bg-mc-accent-yellow/15 text-mc-accent-yellow border-mc-accent-yellow/40'
      : 'bg-mc-accent-red/15 text-mc-accent-red border-mc-accent-red/40';
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${palette}`}>
      {score}
    </span>
  );
}

function FindingCard({
  finding, busy, onResolve,
}: { finding: Finding; busy: boolean; onResolve: () => void }) {
  const palette =
    finding.severity === 'critical'
      ? 'border-mc-accent-red/40 bg-mc-accent-red/5'
      : finding.severity === 'warning'
      ? 'border-mc-accent-yellow/40 bg-mc-accent-yellow/5'
      : 'border-mc-border bg-mc-bg-secondary';
  const Icon =
    finding.severity === 'critical' ? ShieldX
    : finding.severity === 'warning' ? ShieldAlert
    : Info;
  const iconColor =
    finding.severity === 'critical' ? 'text-mc-accent-red'
    : finding.severity === 'warning' ? 'text-mc-accent-yellow'
    : 'text-mc-accent-blue';

  return (
    <div className={`rounded-lg border ${palette} p-3 ${finding.resolved ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] text-mc-text-secondary">{finding.code}</span>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-mc-bg-tertiary border border-mc-border text-mc-text-secondary">
              {SOURCE_LABEL[finding.source]}
            </span>
            {finding.agent_name && (
              <span className="text-[10px] text-mc-text-secondary">
                · {finding.agent_name}{finding.agent_role ? ` (${finding.agent_role})` : ''}
              </span>
            )}
            <span className="text-[10px] text-mc-text-secondary ml-auto">
              {new Date(finding.created_at).toLocaleString()}
            </span>
          </div>
          <p className="text-sm text-mc-text mt-1">{finding.message}</p>
          {finding.evidence && (
            <pre className="text-[11px] font-mono text-mc-text-secondary mt-1.5 px-2 py-1 rounded bg-mc-bg-tertiary border border-mc-border overflow-x-auto whitespace-pre-wrap break-all">
              {finding.evidence}
            </pre>
          )}
          {!finding.resolved && (
            <button
              onClick={onResolve}
              disabled={busy}
              className="mt-2 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-mc-accent-green/10 text-mc-accent-green border border-mc-accent-green/40 hover:bg-mc-accent-green/20 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              Mark resolved
            </button>
          )}
          {finding.resolved && (
            <p className="text-[11px] text-mc-accent-green mt-1.5 inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Resolved {finding.resolved_at ? `at ${new Date(finding.resolved_at).toLocaleString()}` : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function computeCounts(findings: Finding[]): { critical: number; warning: number; info: number; resolved: number } {
  let c = 0, w = 0, i = 0, r = 0;
  for (const f of findings) {
    if (f.resolved) { r += 1; continue; }
    if (f.severity === 'critical') c += 1;
    else if (f.severity === 'warning') w += 1;
    else i += 1;
  }
  return { critical: c, warning: w, info: i, resolved: r };
}
