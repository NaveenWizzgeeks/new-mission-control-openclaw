'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2, CheckCircle2, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';

interface PlanningOption {
  id: string;
  label: string;
}

interface PlanningQuestion {
  id: string;
  category: string;
  question: string;
  question_type: string;
  options: PlanningOption[] | null;
  answer: string | null;
  answered_at: string | null;
  sort_order: number;
}

interface ClarificationChatProps {
  missionId: string;
  workspaceSlug: string;
  onMissionAdvanced?: () => void;
}

// Splits an answer into "selected option label" + optional "Other" text by
// matching against the question's option list. The DB stores answers as a
// single string; for option matches we just store the label, and for "Other"
// we store the user's free-text answer (it won't match any option label).
function deriveSelection(answer: string | null, options: PlanningOption[] | null): { selectedId: string | null; otherText: string } {
  if (!answer || !options) return { selectedId: null, otherText: '' };
  const trimmed = answer.trim();
  const match = options.find(o => o.id !== 'other' && o.label.toLowerCase() === trimmed.toLowerCase());
  if (match) return { selectedId: match.id, otherText: '' };
  // Default to Other when the saved answer doesn't match any preset option
  return { selectedId: 'other', otherText: trimmed };
}

export function ClarificationChat({ missionId, workspaceSlug, onMissionAdvanced }: ClarificationChatProps) {
  const router = useRouter();
  const [questions, setQuestions] = useState<PlanningQuestion[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/missions/${missionId}/questions`);
      if (res.ok) {
        const { questions: qs } = await res.json() as { questions: PlanningQuestion[] };
        setQuestions(qs);
        // Park on the first unanswered question
        const firstUnanswered = qs.findIndex(q => (q.answer ?? '').trim().length === 0);
        setActiveIdx(firstUnanswered >= 0 ? firstUnanswered : 0);
      }
    } catch {
      // surfaced via empty state
    }
  }, [missionId]);

  useEffect(() => { load(); }, [load]);

  // Sync local selection state when active question changes
  const active = questions?.[activeIdx];
  useEffect(() => {
    if (!active) return;
    const { selectedId, otherText } = deriveSelection(active.answer, active.options);
    setSelectedId(selectedId);
    setOtherText(otherText);
    setError(null);
  }, [activeIdx, active]);

  const total = questions?.length ?? 0;
  const answeredCount = questions?.filter(q => (q.answer ?? '').trim().length > 0).length ?? 0;
  const allAnswered = total > 0 && answeredCount === total;

  const submitAnswer = async () => {
    if (!active || !selectedId) return;
    let answerValue: string;
    if (selectedId === 'other') {
      answerValue = otherText.trim();
      if (!answerValue) {
        setError('Please type your answer or pick a preset option.');
        return;
      }
    } else {
      const opt = active.options?.find(o => o.id === selectedId);
      if (!opt) return;
      answerValue = opt.label;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: active.id, answer: answerValue }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Save failed (${res.status})`);
        return;
      }
      await load();
      // Auto-advance to next unanswered if any, else stay
      if (questions) {
        const nextUnanswered = questions.findIndex((q, i) => i > activeIdx && (q.answer ?? '').trim().length === 0);
        if (nextUnanswered >= 0) setActiveIdx(nextUnanswered);
        else if (activeIdx < total - 1) setActiveIdx(activeIdx + 1);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const regenerate = async () => {
    if (!confirm('Regenerate the question set? Existing answers will be cleared.')) return;
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/start-planning?regenerate=true`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Regenerate failed (${res.status})`);
      } else {
        setActiveIdx(0);
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
      router.push(`/workspace/${workspaceSlug}/mission/${missionId}#tasks`);
    } finally {
      setGenerating(false);
    }
  };

  const stepDots = useMemo(() => Array.from({ length: total }, (_, i) => i), [total]);

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
            disabled={regenerating || total === 0}
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
      ) : !active ? null : (
        <div>
          {/* Step dots */}
          <div className="flex items-center justify-center gap-1.5 mb-4">
            {stepDots.map(i => {
              const q = questions![i];
              const a = (q.answer ?? '').trim().length > 0;
              const isActive = i === activeIdx;
              return (
                <button
                  key={i}
                  onClick={() => setActiveIdx(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    isActive ? 'bg-mc-accent w-8' : a ? 'bg-mc-accent-green w-4' : 'bg-mc-bg-tertiary w-4 hover:bg-mc-text-secondary/50'
                  }`}
                  aria-label={`Question ${i + 1}${a ? ' (answered)' : ''}`}
                />
              );
            })}
          </div>

          {/* Active question */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-mc-accent-blue/15 text-mc-accent-blue">
                {active.category}
              </span>
              <span className="text-[10px] text-mc-text-secondary tabular-nums">
                Question {activeIdx + 1} of {total}
              </span>
            </div>
            <h4 className="text-base font-medium text-mc-text leading-snug">
              {active.question}
            </h4>
          </div>

          {/* Options */}
          {active.options && active.options.length > 0 ? (
            <div className="space-y-2">
              {active.options.map(option => {
                const isSelected = selectedId === option.id;
                const isOther = option.id === 'other';
                return (
                  <div key={option.id}>
                    <button
                      onClick={() => setSelectedId(option.id)}
                      disabled={submitting}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left ${
                        isSelected
                          ? 'border-mc-accent bg-mc-accent/10'
                          : 'border-mc-border hover:border-mc-accent/50'
                      } disabled:opacity-50`}
                    >
                      <span className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold shrink-0 ${
                        isSelected ? 'bg-mc-accent text-mc-bg' : 'bg-mc-bg-tertiary'
                      }`}>
                        {option.id.toUpperCase()}
                      </span>
                      <span className="flex-1 text-sm">{option.label}</span>
                      {isSelected && <CheckCircle2 className="w-4 h-4 text-mc-accent shrink-0" />}
                    </button>
                    {isOther && isSelected && (
                      <input
                        type="text"
                        value={otherText}
                        onChange={(e) => setOtherText(e.target.value)}
                        autoFocus
                        placeholder="Type your answer…"
                        className="mt-2 ml-10 w-[calc(100%-2.5rem)] bg-mc-bg border border-mc-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                        disabled={submitting}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            // Fallback: text-only question (legacy or non-MC)
            <textarea
              value={otherText}
              onChange={(e) => { setOtherText(e.target.value); setSelectedId('other'); }}
              rows={3}
              placeholder="Your answer…"
              className="w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none"
            />
          )}

          {error && (
            <div className="mt-3 text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Footer: prev/next/save + final Generate Tasks */}
          <div className="mt-4 pt-4 border-t border-mc-border flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveIdx(Math.max(0, activeIdx - 1))}
                disabled={activeIdx === 0 || submitting}
                className="p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary disabled:opacity-30"
                aria-label="Previous question"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setActiveIdx(Math.min(total - 1, activeIdx + 1))}
                disabled={activeIdx === total - 1 || submitting}
                className="p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary disabled:opacity-30"
                aria-label="Next question"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={submitAnswer}
                disabled={!selectedId || submitting}
                className="flex items-center gap-1.5 px-4 min-h-9 rounded-lg bg-mc-bg-tertiary text-mc-text border border-mc-border text-xs font-medium hover:border-mc-accent/40 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Save & Continue
              </button>
              <button
                onClick={generateTasks}
                disabled={!allAnswered || generating}
                className="flex items-center gap-1.5 px-4 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
                title={!allAnswered ? `Answer all ${total} questions first` : 'Send to Fury for subtask generation'}
              >
                {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {generating ? 'Generating…' : 'Generate Tasks'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
