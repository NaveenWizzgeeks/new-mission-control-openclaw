'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  X, Star, Download, Loader2, ShieldCheck, ShieldAlert, ShieldX, Info,
  CheckCircle2, AlertTriangle, ExternalLink, Terminal, Users, User, Globe2
} from 'lucide-react';
import type { MarketplaceDetail, MarketplaceKind, MarketplaceSource, SecurityFinding } from '@/lib/skills-marketplace/types';
import { InstallToAgentPicker, type AgentOption } from './InstallToAgentPicker';

type InstallScope = 'agent' | 'role' | 'all';

interface SkillDetailModalProps {
  slug: string;
  kind?: MarketplaceKind;
  source?: MarketplaceSource;
  onClose: () => void;
  onInstalled: () => void;
}

export function SkillDetailModal({ slug, kind = 'skill', source, onClose, onInstalled }: SkillDetailModalProps) {
  const [detail, setDetail] = useState<MarketplaceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentsErr, setAgentsErr] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string>('');
  const [scope, setScope] = useState<InstallScope>('agent');
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [forceOverride, setForceOverride] = useState(false);

  // Load detail.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ kind });
        if (source) params.set('source', source);
        const res = await fetch(`/api/skills/marketplace/${encodeURIComponent(slug)}?${params.toString()}`);
        if (!res.ok) {
          if (!cancelled) setError(`Failed to load ${kind} (${res.status})`);
          return;
        }
        const data = await res.json();
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : `Failed to load ${kind}`);
      }
    })();
    return () => { cancelled = true; };
  }, [slug, kind, source]);

  // Load agents (once).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agents');
        if (!res.ok) {
          if (!cancelled) setAgentsErr(`Could not load agents (${res.status})`);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        const list: AgentOption[] = Array.isArray(data) ? data : (data.agents ?? []);
        setAgents(list);
        if (list.length > 0) {
          // Default selection: lead, else global, else first.
          const lead = list.find(a => a.is_lead);
          const global = list.find(a => a.is_global);
          setAgentId((lead ?? global ?? list[0]).id);
        }
      } catch (err) {
        if (!cancelled) setAgentsErr(err instanceof Error ? err.message : 'Failed to load agents');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selectedAgent = useMemo(() => agents.find(a => a.id === agentId), [agents, agentId]);
  const role = (selectedAgent?.role ?? '').toLowerCase();
  const roleCount = role ? agents.filter(a => (a.role ?? '').toLowerCase() === role).length : 0;
  const allCount = agents.length;

  const install = async () => {
    if (scope === 'agent' && !agentId) return;
    if (scope === 'role' && !role) return;
    setInstalling(true);
    setInstallResult(null);
    try {
      const body: Record<string, unknown> = { force: forceOverride, kind, source, scope };
      if (scope === 'agent') body.agent_id = agentId;
      if (scope === 'role') body.role = role;
      const res = await fetch(`/api/skills/marketplace/${encodeURIComponent(slug)}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInstallResult({ ok: false, message: data.error || `Install failed (${res.status})` });
        return;
      }

      let msg: string;
      if (data.scope === 'agent') {
        msg = `Installed on ${data.installed?.agent_name ?? 'agent'}.`;
      } else {
        const target = data.scope === 'all' ? 'all agents' : `every ${data.role} agent`;
        const p = data.propagation;
        msg =
          `Templated for ${target}: ${p.inserted_skills} new install${p.inserted_skills === 1 ? '' : 's'}` +
          (p.skipped_existing > 0 ? `, ${p.skipped_existing} already had it` : '') +
          ` (across ${p.matched_agents} matching agent${p.matched_agents === 1 ? '' : 's'}). ` +
          `Future ${data.scope === 'all' ? 'agents' : data.role + ' agents'} will inherit it automatically.`;
      }
      if (data.install_hint) msg += ` ${data.install_hint}`;
      setInstallResult({ ok: true, message: msg });
      onInstalled();
    } catch (err) {
      setInstallResult({ ok: false, message: err instanceof Error ? err.message : 'Install failed' });
    } finally {
      setInstalling(false);
    }
  };

  const critical = (detail?.security_findings ?? []).filter(f => f.severity === 'critical');

  const installDisabled =
    installing ||
    (critical.length > 0 && !forceOverride) ||
    (scope === 'agent' && !agentId) ||
    (scope === 'role' && (!role || roleCount === 0)) ||
    agents.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col rounded-xl bg-mc-bg border border-mc-border shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-mc-border">
          <div className="min-w-0">
            {detail ? (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-mc-text truncate">{detail.name}</h2>
                  {detail.source === 'clawhub' && (
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-mc-accent-cyan/15 text-mc-accent-cyan border border-mc-accent-cyan/40 shrink-0">
                      ClawHub {detail.kind}
                    </span>
                  )}
                  {detail.source === 'local' && (
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-mc-bg-tertiary text-mc-text-secondary border border-mc-border shrink-0">
                      Local
                    </span>
                  )}
                </div>
                <p className="text-xs text-mc-text-secondary mt-0.5">
                  {detail.author} · v{detail.version}{detail.updated_at ? ` · updated ${detail.updated_at}` : ''}
                  {detail.external_url && (
                    <>
                      {' · '}
                      <a
                        href={detail.external_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-0.5 text-mc-accent-cyan hover:underline"
                      >
                        view on clawhub.ai <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </>
                  )}
                </p>
              </>
            ) : (
              <h2 className="text-lg font-semibold text-mc-text">Loading…</h2>
            )}
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {error && (
            <div className="text-sm text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {!detail && !error && (
            <div className="flex items-center gap-2 text-sm text-mc-text-secondary py-12 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading skill details…
            </div>
          )}

          {detail && (
            <>
              {/* Stats row */}
              <div className="flex flex-wrap items-center gap-4 text-xs text-mc-text-secondary">
                <span className="flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 fill-mc-accent-yellow text-mc-accent-yellow" />
                  {detail.rating.toFixed(1)} ({detail.rating_count} ratings)
                </span>
                <span className="flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5" />
                  {detail.installs.toLocaleString()} installs
                </span>
                <span className="px-2 py-0.5 rounded border border-mc-border bg-mc-bg-secondary capitalize">
                  {detail.category.replace('-', ' ')}
                </span>
                {detail.tags.map(t => (
                  <span key={t} className="px-1.5 py-0.5 rounded bg-mc-bg-secondary border border-mc-border">{t}</span>
                ))}
              </div>

              {/* Description */}
              <section>
                <h3 className="text-xs uppercase tracking-wider text-mc-text-secondary mb-1.5">Description</h3>
                <p className="text-sm text-mc-text leading-relaxed">{detail.short_description}</p>
                <p className="text-sm text-mc-text-secondary leading-relaxed mt-2 whitespace-pre-wrap">{detail.readme}</p>
              </section>

              {/* Install template preview */}
              <section>
                <h3 className="text-xs uppercase tracking-wider text-mc-text-secondary mb-1.5">What gets installed</h3>
                <div className="rounded-lg border border-mc-border bg-mc-bg-secondary px-3 py-2 text-xs font-mono">
                  <div><span className="text-mc-text-secondary">type:</span> {detail.install_template.skill_type}</div>
                  <div><span className="text-mc-text-secondary">name:</span> {detail.install_template.skill_name}</div>
                  <pre className="mt-1 text-[11px] text-mc-text-secondary whitespace-pre-wrap break-all">{JSON.stringify(detail.install_template.skill_config, null, 2)}</pre>
                </div>
                {detail.install_hint && (
                  <div className="mt-2 flex items-start gap-2 text-[11px] text-mc-text-secondary bg-mc-accent-blue/5 border border-mc-accent-blue/20 rounded-lg px-3 py-2">
                    <Terminal className="w-3 h-3 mt-0.5 shrink-0 text-mc-accent-blue" />
                    <span>{detail.install_hint}</span>
                  </div>
                )}
              </section>

              {/* Security report */}
              <section>
                <h3 className="text-xs uppercase tracking-wider text-mc-text-secondary mb-1.5 flex items-center gap-1.5">
                  Security scan
                  {critical.length === 0 ? (
                    <ShieldCheck className="w-3.5 h-3.5 text-mc-accent-green" />
                  ) : (
                    <ShieldX className="w-3.5 h-3.5 text-mc-accent-red" />
                  )}
                </h3>

                {detail.security_findings.length === 0 ? (
                  <p className="text-xs text-mc-text-secondary">Clean — no issues found.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {detail.security_findings.map((f, i) => (
                      <FindingRow key={i} finding={f} />
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        {detail && (
          <div className="border-t border-mc-border px-5 py-4 space-y-3 bg-mc-bg-secondary/40">
            {agentsErr && (
              <p className="text-xs text-mc-accent-red">{agentsErr}</p>
            )}

            {/* Scope picker */}
            <div className="rounded-lg border border-mc-accent/30 bg-mc-accent/5 p-3 space-y-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-mc-accent mb-1.5 font-semibold">
                  Install scope
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <ScopeChip
                    selected={scope === 'agent'}
                    onClick={() => setScope('agent')}
                    icon={<User className="w-3.5 h-3.5" />}
                    title="This agent only"
                    detail={selectedAgent ? selectedAgent.name : 'pick one below'}
                  />
                  <ScopeChip
                    selected={scope === 'role'}
                    onClick={() => setScope('role')}
                    disabled={!role}
                    icon={<Users className="w-3.5 h-3.5" />}
                    title={role ? `All ${role} agents` : 'All <role> agents'}
                    detail={role ? `${roleCount} now · future ones inherit` : 'pick an agent first'}
                  />
                  <ScopeChip
                    selected={scope === 'all'}
                    onClick={() => setScope('all')}
                    icon={<Globe2 className="w-3.5 h-3.5" />}
                    title="All agents"
                    detail={`${allCount} now · future ones inherit`}
                  />
                </div>
              </div>

              <InstallToAgentPicker
                agents={agents}
                value={agentId}
                onChange={setAgentId}
                disabled={installing || scope === 'all'}
                label={scope === 'agent' ? 'Install on agent' : 'Use this agent\'s role for templating'}
              />
            </div>

            {critical.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-mc-accent-red cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceOverride}
                  onChange={e => setForceOverride(e.target.checked)}
                />
                Override critical findings and install anyway (not recommended)
              </label>
            )}

            {installResult && (
              <div
                className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 border ${
                  installResult.ok
                    ? 'text-mc-accent-green bg-mc-accent-green/10 border-mc-accent-green/30'
                    : 'text-mc-accent-red bg-mc-accent-red/10 border-mc-accent-red/30'
                }`}
              >
                {installResult.ok
                  ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                <span>{installResult.message}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="min-h-9 px-3 rounded-lg text-xs text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary"
              >
                Close
              </button>
              <button
                onClick={install}
                disabled={installDisabled}
                className="flex items-center gap-1.5 px-4 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {installing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {critical.length > 0 && !forceOverride
                  ? 'Blocked by security scan'
                  : scope === 'agent'
                  ? 'Install on agent'
                  : scope === 'role'
                  ? `Install for all ${role} agents`
                  : 'Install for all agents'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScopeChip({
  selected, onClick, disabled, icon, title, detail,
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-left px-2.5 py-2 rounded-lg border text-xs transition-colors ${
        selected
          ? 'border-mc-accent bg-mc-accent/10 text-mc-text'
          : 'border-mc-border bg-mc-bg text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <div className="flex items-center gap-1.5 font-medium truncate">
        {icon} <span className="truncate">{title}</span>
      </div>
      <div className="text-[10px] opacity-80 mt-0.5 truncate">{detail}</div>
    </button>
  );
}

function FindingRow({ finding }: { finding: SecurityFinding }) {
  const palette =
    finding.severity === 'critical'
      ? 'text-mc-accent-red bg-mc-accent-red/10 border-mc-accent-red/30'
      : finding.severity === 'warning'
      ? 'text-mc-accent-yellow bg-mc-accent-yellow/10 border-mc-accent-yellow/30'
      : 'text-mc-text-secondary bg-mc-bg-secondary border-mc-border';
  const Icon = finding.severity === 'critical' ? ShieldX : finding.severity === 'warning' ? ShieldAlert : Info;
  return (
    <li className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 border ${palette}`}>
      <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <span className="font-mono text-[11px] opacity-70">{finding.code}</span>
        <p className="leading-snug">{finding.message}</p>
      </div>
    </li>
  );
}
