'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Send, Loader2, CheckCircle2, RefreshCw } from 'lucide-react';

interface PlanningQuestion {
  id: string;
  category: string;
  question: string;
  question_type: string;
  answer: string | null;
  answered_at: string | null;
  sort_order: number;
}

interface ClarificationChatProps {
  missionId: string;
  workspaceSlug: string;
  onMissionAdvanced?: () => void;
}

export function ClarificationChat({ missionId, workspaceSlug, onMissionAdvanced }: ClarificationChatProps) {
  const router = useRouter();
  const [questions, setQuestions] = useState<PlanningQuestion[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/missions/${missionId}/questions`);
      if (res.ok) {
        const { questions: qs } = await res.json() as { questions: PlanningQuestion[] };
        setQuestions(qs);
        // Seed drafts from saved answers
        const seeded: Record<string, string> = {};
        for (const q of qs) seeded[q.id] = q.answer ?? '';
        setDrafts(prev => ({ ...seeded, ...prev }));
      }
    } catch {
      // surfaced via the empty state
    }
  }, [missionId]);

  useEffect(() => { load(); }, [load]);

  const saveAnswer = async (q: PlanningQuestion) => {
    const value = (drafts[q.id] ?? '').trim();
    if (value === (q.answer ?? '').trim()) return; // nothing changed

    setSavingId(q.id);
    setError(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: q.id, answer: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Save failed (${res.status})`);
      } else {
        await load();
      }
    } finally {
      setSavingId(null);
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/start-planning?regenerate=true`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Regenerate failed (${res.status})`);
      } else {
        setDrafts({});
        await load();
      }
    } finally {
      setRegenerating(false);
    }
  };

  const generateTasks = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/generate-tasks`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Generate failed (${res.status})`);
        return;
      }
      onMissionAdvanced?.();
      // Jump to the Task Board so the user sees the new subtasks
      router.push(`/workspace/${workspaceSlug}/mission/${missionId}#tasks`);
    } finally {
      setGenerating(false);
    }
  };

  const total = questions?.length ?? 0;
  const answeredCount = questions?.filter(q => (q.answer ?? '').trim().length > 0).length ?? 0;
  const allAnswered = total > 0 && answeredCount === total;

  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-mc-text-secondary flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-mc-accent" />
          Fury Clarification
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-mc-text-secondary tabular-nums">
            {answeredCount}/{total} answered
          </span>
          <button
            onClick={regenerate}
            disabled={regenerating}
            className="text-xs px-2 py-1 rounded bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text border border-mc-border flex items-center gap-1 disabled:opacity-50"
            title="Ask Fury for a fresh question set"
          >
            {regenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Regenerate
          </button>
        </div>
      </div>

      {questions === null ? (
        <p className="text-sm text-mc-text-secondary">Loading…</p>
      ) : total === 0 ? (
        <p className="text-sm text-mc-text-secondary">
          No questions yet. Click <strong>Regenerate</strong> to ask Fury for a clarification set.
        </p>
      ) : (
        <ul className="space-y-3">
          {questions.map(q => {
            const draft = drafts[q.id] ?? '';
            const saved = (q.answer ?? '').trim();
            const dirty = draft.trim() !== saved;
            const answered = saved.length > 0;
            return (
              <li key={q.id} className="bg-mc-bg/40 rounded-lg p-3 border border-mc-border/50">
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-mc-accent-blue/15 text-mc-accent-blue shrink-0 mt-0.5">
                    {q.category}
                  </span>
                  <p className="text-sm text-mc-text leading-snug flex-1">{q.question}</p>
                  {answered && !dirty && <CheckCircle2 className="w-4 h-4 text-mc-accent-green shrink-0 mt-0.5" />}
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDrafts(prev => ({ ...prev, [q.id]: e.target.value }))}
                    rows={2}
                    placeholder="Your answer…"
                    className="flex-1 bg-mc-bg border border-mc-border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-mc-accent resize-none"
                  />
                  <button
                    onClick={() => saveAnswer(q)}
                    disabled={!dirty || savingId === q.id}
                    className="flex items-center gap-1 px-3 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {savingId === q.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Save
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <div className="mt-3 text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {total > 0 && (
        <div className="mt-4 pt-4 border-t border-mc-border flex items-center justify-end">
          <button
            onClick={generateTasks}
            disabled={!allAnswered || generating}
            className="flex items-center gap-2 px-4 min-h-10 rounded-lg bg-mc-accent text-mc-bg text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? 'Generating subtasks…' : allAnswered ? 'Generate Tasks' : `Answer ${total - answeredCount} more`}
          </button>
        </div>
      )}
    </div>
  );
}
