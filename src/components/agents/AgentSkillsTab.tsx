'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Edit3, Loader2, Save, X, ToggleLeft, ToggleRight, AlertCircle } from 'lucide-react';

const SKILL_TYPES = ['shell', 'mcp', 'prompt_inject', 'file_access'] as const;
type SkillType = typeof SKILL_TYPES[number];

interface AgentSkill {
  id: string;
  agent_id: string;
  skill_type: SkillType;
  skill_name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  created_at: string;
}

const TYPE_BADGE: Record<SkillType, string> = {
  shell: 'bg-mc-accent-yellow/15 text-mc-accent-yellow border-mc-accent-yellow/40',
  mcp: 'bg-mc-accent-purple/15 text-mc-accent-purple border-mc-accent-purple/40',
  prompt_inject: 'bg-mc-accent-blue/15 text-mc-accent-blue border-mc-accent-blue/40',
  file_access: 'bg-mc-accent-green/15 text-mc-accent-green border-mc-accent-green/40',
};

const TYPE_LABEL: Record<SkillType, string> = {
  shell: 'Shell',
  mcp: 'MCP',
  prompt_inject: 'Prompt',
  file_access: 'File',
};

interface AgentSkillsTabProps { agentId: string }

export function AgentSkillsTab({ agentId }: AgentSkillsTabProps) {
  const [skills, setSkills] = useState<AgentSkill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // skill id, or 'new'
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/skills?agent_id=${agentId}`);
      if (res.ok) setSkills(await res.json());
      else setSkills([]);
    } catch {
      setSkills([]);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/skills/${id}/toggle`, { method: 'PATCH' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Toggle failed (${res.status})`);
      } else {
        await load();
      }
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete skill "${name}"?`)) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/skills/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Delete failed (${res.status})`);
      } else {
        await load();
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-mc-text">Skills</h3>
          <p className="text-xs text-mc-text-secondary mt-0.5">
            Capabilities injected into the agent&apos;s dispatch prompt at every spawn.
            Skills follow the agent into every mission.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-1.5 px-3 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90"
        >
          <Plus className="w-3.5 h-3.5" /> Add Skill
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-mc-text-secondary hover:text-mc-text"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {editing === 'new' && (
        <SkillForm
          agentId={agentId}
          onSaved={() => { setEditing(null); load(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {skills === null ? (
        <p className="text-sm text-mc-text-secondary py-4">Loading…</p>
      ) : skills.length === 0 && editing !== 'new' ? (
        <div className="rounded-lg border border-dashed border-mc-border bg-mc-bg-secondary/40 p-6 text-center text-sm text-mc-text-secondary">
          No skills yet. Click <strong>Add Skill</strong> to grant this agent a tool, MCP server,
          file path, or prompt fragment.
        </div>
      ) : (
        <ul className="space-y-2">
          {(skills ?? []).map(s => (
            <li key={s.id}>
              {editing === s.id ? (
                <SkillForm
                  agentId={agentId}
                  skill={s}
                  onSaved={() => { setEditing(null); load(); }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className={`flex items-start gap-3 p-3 rounded-lg border bg-mc-bg-secondary border-mc-border ${s.enabled ? '' : 'opacity-60'}`}>
                  <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 mt-0.5 ${TYPE_BADGE[s.skill_type]}`}>
                    {TYPE_LABEL[s.skill_type]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-mc-text">{s.skill_name}</p>
                    <pre className="text-[11px] text-mc-text-secondary font-mono whitespace-pre-wrap break-all mt-1 leading-snug">
                      {summarizeConfig(s.skill_type, s.config)}
                    </pre>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggle(s.id)}
                      disabled={busyId === s.id}
                      title={s.enabled ? 'Disable' : 'Enable'}
                      className="p-1.5 rounded hover:bg-mc-bg-tertiary"
                    >
                      {busyId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : (s.enabled ? <ToggleRight className="w-4 h-4 text-mc-accent-green" /> : <ToggleLeft className="w-4 h-4 text-mc-text-secondary" />)}
                    </button>
                    <button
                      onClick={() => setEditing(s.id)}
                      className="p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary"
                      title="Edit"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => remove(s.id, s.skill_name)}
                      disabled={busyId === s.id}
                      className="p-1.5 rounded hover:bg-mc-accent-red/10 text-mc-accent-red"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function summarizeConfig(type: SkillType, cfg: Record<string, unknown>): string {
  switch (type) {
    case 'shell': return `command: ${cfg.command ?? '(not set)'}`;
    case 'mcp': return `url: ${cfg.url ?? '(not set)'}`;
    case 'prompt_inject': return String(cfg.content ?? '').slice(0, 240) || '(empty)';
    case 'file_access': {
      const paths = Array.isArray(cfg.paths) ? (cfg.paths as string[]).join(', ') : '(no paths)';
      return `${cfg.read_only === false ? 'read+write' : 'read-only'}: ${paths}`;
    }
  }
}

function SkillForm({
  agentId,
  skill,
  onSaved,
  onCancel,
}: {
  agentId: string;
  skill?: AgentSkill;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<SkillType>(skill?.skill_type ?? 'shell');
  const [name, setName] = useState(skill?.skill_name ?? '');
  const [shellCmd, setShellCmd] = useState(typeof skill?.config?.command === 'string' ? skill.config.command : '');
  const [shellDesc, setShellDesc] = useState(typeof skill?.config?.description === 'string' ? skill.config.description : '');
  const [mcpUrl, setMcpUrl] = useState(typeof skill?.config?.url === 'string' ? skill.config.url : '');
  const [promptText, setPromptText] = useState(typeof skill?.config?.content === 'string' ? skill.config.content : '');
  const [pathsText, setPathsText] = useState(Array.isArray(skill?.config?.paths) ? (skill.config.paths as string[]).join('\n') : '');
  const [readOnly, setReadOnly] = useState<boolean>(skill?.config?.read_only !== false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isEdit = !!skill;
  const inputCls = 'w-full min-h-9 bg-mc-bg border border-mc-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-mc-accent';
  const taCls = 'w-full bg-mc-bg border border-mc-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none';

  const save = async () => {
    if (!name.trim()) { setErr('Name is required'); return; }
    let config: Record<string, unknown> = {};
    if (type === 'shell') {
      if (!shellCmd.trim()) { setErr('Shell command is required'); return; }
      config = { command: shellCmd.trim(), description: shellDesc.trim() || undefined };
    } else if (type === 'mcp') {
      if (!mcpUrl.trim()) { setErr('MCP server URL is required'); return; }
      config = { url: mcpUrl.trim(), name: name.trim() };
    } else if (type === 'prompt_inject') {
      if (!promptText.trim()) { setErr('Prompt content is required'); return; }
      config = { content: promptText.trim() };
    } else if (type === 'file_access') {
      const paths = pathsText.split('\n').map(p => p.trim()).filter(Boolean);
      if (paths.length === 0) { setErr('At least one path is required'); return; }
      config = { paths, read_only: readOnly };
    }

    setSaving(true);
    setErr(null);
    try {
      const url = isEdit ? `/api/skills/${skill!.id}` : '/api/skills';
      const method = isEdit ? 'PATCH' : 'POST';
      const body = isEdit
        ? { skill_type: type, skill_name: name.trim(), skill_config: config }
        : { agent_id: agentId, skill_type: type, skill_name: name.trim(), skill_config: config };
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.error || `Save failed (${res.status})`);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-mc-accent/40 bg-mc-bg/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">{isEdit ? 'Edit skill' : 'New skill'}</h4>
        <button onClick={onCancel} className="text-mc-text-secondary hover:text-mc-text" aria-label="Cancel">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Type</label>
          <select
            value={type}
            onChange={e => setType(e.target.value as SkillType)}
            className={inputCls}
          >
            {SKILL_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="git_diff, playwright, etc."
            className={`${inputCls} font-mono`}
          />
        </div>
      </div>

      {type === 'shell' && (
        <>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Command</label>
            <input type="text" value={shellCmd} onChange={e => setShellCmd(e.target.value)} className={`${inputCls} font-mono`} placeholder="git diff" />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Description (optional)</label>
            <input type="text" value={shellDesc} onChange={e => setShellDesc(e.target.value)} className={inputCls} placeholder="What the agent uses this for" />
          </div>
        </>
      )}

      {type === 'mcp' && (
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Server URL</label>
          <input type="text" value={mcpUrl} onChange={e => setMcpUrl(e.target.value)} className={`${inputCls} font-mono`} placeholder="https://mcp.example.com" />
        </div>
      )}

      {type === 'prompt_inject' && (
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Content</label>
          <textarea value={promptText} onChange={e => setPromptText(e.target.value)} rows={4} className={taCls} placeholder="Appended to the agent's system prompt at dispatch." />
        </div>
      )}

      {type === 'file_access' && (
        <>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-mc-text-secondary mb-1">Paths (one per line)</label>
            <textarea value={pathsText} onChange={e => setPathsText(e.target.value)} rows={3} className={`${taCls} font-mono`} placeholder="./src&#10;./tests" />
          </div>
          <label className="flex items-center gap-2 text-xs text-mc-text-secondary cursor-pointer">
            <input type="checkbox" checked={readOnly} onChange={e => setReadOnly(e.target.checked)} />
            Read-only
          </label>
        </>
      )}

      {err && (
        <div className="text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded px-2 py-1">
          {err}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} className="min-h-9 px-3 rounded-lg text-xs text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save
        </button>
      </div>
    </div>
  );
}
