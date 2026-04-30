'use client';

import { useState } from 'react';
import { X, Target, Database, GitBranch, Sparkles, Layers } from 'lucide-react';

interface MissionModalProps {
  workspaceId: string;
  onClose: () => void;
  onCreated?: () => void;
}

interface FormState {
  title: string;
  description: string;
  enable_pipeline: boolean;
  enable_existing_codebase: boolean;
  codebase_path: string;
  git_branch: string;
  tech_stack_hint: string;
  success_criteria: string;
}

const INITIAL: FormState = {
  title: '',
  description: '',
  enable_pipeline: true,
  enable_existing_codebase: false,
  codebase_path: '',
  git_branch: '',
  tech_stack_hint: '',
  success_criteria: '',
};

function isAbsolutePath(p: string): boolean {
  if (!p) return true; // empty is fine — only required when existing-codebase is enabled
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p);
}

export function MissionModal({ workspaceId, onClose, onCreated }: MissionModalProps) {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;

    if (form.enable_existing_codebase) {
      if (!form.codebase_path.trim()) {
        setError('Codebase path is required when "Existing codebase" is enabled.');
        return;
      }
      if (!isAbsolutePath(form.codebase_path.trim())) {
        setError('Codebase path must be an absolute path (starts with / on Linux/macOS or X:\\ on Windows).');
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const body = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        workspace_id: workspaceId,
        enable_pipeline: form.enable_pipeline,
        enable_existing_codebase: form.enable_existing_codebase,
        codebase_path: form.enable_existing_codebase ? form.codebase_path.trim() : undefined,
        git_branch: form.git_branch.trim() || undefined,
        tech_stack_hint: form.tech_stack_hint.trim() || undefined,
        success_criteria: form.success_criteria.trim() || undefined,
      };

      const res = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Create failed (${res.status})`);
        return;
      }

      onCreated?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClasses = 'w-full min-h-10 bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-mc-accent';
  const textareaClasses = 'w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-xl w-full max-w-2xl flex flex-col my-auto shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-mc-border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Target className="w-5 h-5 text-mc-accent" />
            New Mission
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-mc-bg-tertiary rounded"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Title <span className="text-mc-accent-red">*</span></label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              required
              autoFocus
              className={inputClasses}
              placeholder="What's the mission?"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Description <span className="text-mc-accent-red">*</span>
              <span className="ml-2 text-xs text-mc-text-secondary font-normal">— this feeds the planner's context, be detailed</span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              required
              rows={5}
              className={textareaClasses}
              placeholder="What needs to be built or changed? Include constraints, examples, anything Fury should know."
            />
          </div>

          {/* Pipeline toggle */}
          <ToggleRow
            icon={<Sparkles className="w-4 h-4 text-mc-accent" />}
            label="Enable Pipeline"
            description="Run the Fury planning pipeline (clarification + subtask generation) before work starts. Recommended."
            checked={form.enable_pipeline}
            onChange={(v) => set('enable_pipeline', v)}
          />

          {/* Existing codebase toggle */}
          <ToggleRow
            icon={<Database className="w-4 h-4 text-mc-accent-purple" />}
            label="Existing Codebase"
            description="Analyze a project already on disk before planning. Required if you want Fury to build on top of existing code."
            checked={form.enable_existing_codebase}
            onChange={(v) => set('enable_existing_codebase', v)}
          />

          {/* Codebase path — only when existing codebase enabled */}
          {form.enable_existing_codebase && (
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Codebase Path <span className="text-mc-accent-red">*</span>
              </label>
              <input
                type="text"
                value={form.codebase_path}
                onChange={(e) => set('codebase_path', e.target.value)}
                className={`${inputClasses} font-mono`}
                placeholder="/absolute/path/to/your/project"
              />
              <p className="text-xs text-mc-text-secondary mt-1">
                Absolute path. Must exist on disk on the host running Mission Control.
              </p>
            </div>
          )}

          {/* Git branch */}
          <div>
            <label className="block text-sm font-medium mb-1.5 flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 text-mc-text-secondary" />
              Git Branch <span className="ml-1 text-xs text-mc-text-secondary font-normal">— optional, target branch for PRs</span>
            </label>
            <input
              type="text"
              value={form.git_branch}
              onChange={(e) => set('git_branch', e.target.value)}
              className={`${inputClasses} font-mono`}
              placeholder="feature/my-mission"
            />
          </div>

          {/* Tech stack hint */}
          <div>
            <label className="block text-sm font-medium mb-1.5 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-mc-text-secondary" />
              Tech Stack Hint <span className="ml-1 text-xs text-mc-text-secondary font-normal">— optional</span>
            </label>
            <input
              type="text"
              value={form.tech_stack_hint}
              onChange={(e) => set('tech_stack_hint', e.target.value)}
              className={inputClasses}
              placeholder="Next.js 14, Postgres, TypeScript"
            />
          </div>

          {/* Success criteria */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Success Criteria <span className="ml-1 text-xs text-mc-text-secondary font-normal">— optional, what does &ldquo;done&rdquo; look like?</span>
            </label>
            <textarea
              value={form.success_criteria}
              onChange={(e) => set('success_criteria', e.target.value)}
              rows={3}
              className={textareaClasses}
              placeholder="Specific, measurable outcomes. Tests pass, route returns 200, etc."
            />
          </div>

          {error && (
            <div className="text-sm text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-mc-border">
            <button
              type="button"
              onClick={onClose}
              className="min-h-10 px-4 rounded-lg text-sm text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !form.title.trim() || !form.description.trim()}
              className="min-h-10 px-5 rounded-lg text-sm font-medium bg-mc-accent text-mc-bg hover:bg-mc-accent/90 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating…' : 'Create Mission'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 p-3 rounded-lg border border-mc-border bg-mc-bg/50 hover:border-mc-accent/40 transition-colors cursor-pointer">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-mc-text-secondary mt-0.5">{description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`shrink-0 relative w-9 h-5 rounded-full transition-colors ${
          checked ? 'bg-mc-accent' : 'bg-mc-bg-tertiary'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}
