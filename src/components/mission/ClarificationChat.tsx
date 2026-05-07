'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2, CheckCircle2, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { useConfirm } from '@/components/ConfirmDialog';

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

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 90_000;

function deriveSelection(answer: string | null, options: PlanningOption[] | null): { selectedId: string | null; otherText: string } {
  if (!answer || !options) return { selectedId: null, otherText: '' };
  const trimmed = answer.trim();
  const match = options.find(o => o.id !== 'other' && o.label.toLowerCase() === trimmed.toLowerCase());
  if (match) return { selectedId: match.id, otherText: '' };
  return { selectedId: 'other', otherText: trimmed };
}

export function ClarificationChat({ missionId, workspaceSlug, onMissionAdvanced }: ClarificationChatProps) {
  const confirmModal = useConfirm();
  const router = useRouter();
  const [questions, setQuestions] = useState<PlanningQuestion[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [waitingForFury, setWaitingForFury] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const pollAbortRef = useRef<AbortController | null>(null);

  // Poll Fury once. Returns whether we should keep polling (true if no new
  // question arrived yet AND mission isn't complete).
  const pollOnce = useCallback(async (currentQuestionCount: number, signal: AbortSignal): Promise<{
    keepPolling: boolean;
    reachedTotal: number;
    completed: boolean;
  }> => {
    const res = await fetch(`/api/missions/${missionId}/planning/poll`, {
      method: 'POST',
      signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Poll failed (${res.status})`);
    }
    const data = await res.json() as {
      is_complete: boolean;
      questions?: PlanningQuestion[];
      total?: number;
    };

    if (data.is_complete) {
      return { keepPolling: false, reachedTotal: currentQuestionCount, completed: true };
    }

    if (Array.isArray(data.questions)) {
      setQuestions(data.questions);
      const next = data.questions.length;
      // If new questions arrived, jump to the first unanswered one
      if (next > currentQuestionCount) {
        const firstUnanswered = data.questions.findIndex(q => (q.answer ?? '').trim().length === 0);
        if (firstUnanswered >= 0) setActiveIdx(firstUnanswered);
      }
      return { keepPolling: next === currentQuestionCount, reachedTotal: next, completed: false };
    }

    return { keepPolling: true, reachedTotal: currentQuestionCount, completed: false };
  }, [missionId]);

  // Drive a poll loop until either new content arrives or the timeout fires.
  const pollUntilProgress = useCallback(async (priorCount: number) => {
    pollAbortRef.current?.abort();
    const ctrl = new AbortController();
    pollAbortRef.current = ctrl;
    setWaitingForFury(true);
    setError(null);

    const start = Date.now();
    try {
      while (Date.now() - start < POLL_TIMEOUT_MS) {
        if (ctrl.signal.aborted) return;
        try {
          const { keepPolling, completed } = await pollOnce(priorCount, ctrl.signal);
          if (completed) {
            setIsComplete(true);
            onMissionAdvanced?.();
            router.push(`/workspace/${workspaceSlug}/mission/${missionId}#tasks`);
            return;
          }
          if (!keepPolling) return; // new question arrived
        } catch (err) {
          if ((err as Error).name === 'AbortError') return;
          throw err;
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }
      setError('Fury is taking longer than expected. Try again, or regenerate the question set.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Poll failed');
    } finally {
      if (!ctrl.signal.aborted) setWaitingForFury(false);
    }
  }, [pollOnce, onMissionAdvanced, router, workspaceSlug, missionId]);

  // Initial load: fetch any persisted questions immediately, then start polling
  // for the first one (since start-planning only kicks Fury off; the question
  // arrives async).
  const loadInitial = useCallback(async () => {
    try {
      const res = await fetch(`/api/missions/${missionId}/questions`);
      if (res.ok) {
        const { questions: qs } = await res.json() as { questions: PlanningQuestion[] };
        setQuestions(qs);
        const firstUnanswered = qs.findIndex(q => (q.answer ?? '').trim().length === 0);
        setActiveIdx(firstUnanswered >= 0 ? firstUnanswered : 0);
        if (qs.length === 0) {
          // No questions yet — Fury hasn't replied. Start polling.
          await pollUntilProgress(0);
        }
      }
    } catch {
      // surfaced via empty state
    }
  }, [missionId, pollUntilProgress]);

  useEffect(() => {
    loadInitial();
    return () => {
      pollAbortRef.current?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

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
      // Optimistically update local state
      setQuestions(prev => prev ? prev.map(q => q.id === active.id ? { ...q, answer: answerValue, answered_at: new Date().toISOString() } : q) : prev);
      // Poll for Fury's next move (next question or final spec)
      await pollUntilProgress(total);
    } finally {
      setSubmitting(false);
    }
  };

  const regenerate = async () => {
    if (!await confirmModal({
      title: 'Regenerate planning questions?',
      body: 'Clears your existing answers and starts a fresh clarification session with new questions.',
      confirmLabel: 'Regenerate',
      danger: true,
    })) return;
    setRegenerating(true);
    setError(null);
    pollAbortRef.current?.abort();
    try {
      const res = await fetch(`/api/missions/${missionId}/start-planning?regenerate=true`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Regenerate failed (${res.status})`);
        return;
      }
      setQuestions([]);
      setActiveIdx(0);
      await pollUntilProgress(0);
    } finally {
      setRegenerating(false);
    }
  };

  const stepDots = useMemo(() => Array.from({ length: total }, (_, i) => i), [total]);

  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-mc-text-secondary flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-mc-accent" />
          Fury Clarification
          {waitingForFury && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] normal-case tracking-normal text-mc-accent-blue">
              <Loader2 className="w-3 h-3 animate-spin" /> Fury is thinking…
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-mc-text-secondary tabular-nums">
            {answeredCount}/{total} answered
          </span>
          <button
            onClick={regenerate}
            disabled={regenerating || waitingForFury}
            className="text-xs px-2 py-1 rounded bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text border border-mc-border flex items-center gap-1 disabled:opacity-50"
            title="Restart the planning session with Fury"
          >
            {regenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Regenerate
          </button>
        </div>
      </div>

      {questions === null ? (
        <p className="text-sm text-mc-text-secondary">Loading…</p>
      ) : isComplete ? (
        <div className="text-sm text-mc-accent-green flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Fury finished planning. Loading the task board…
        </div>
      ) : total === 0 ? (
        <div className="text-sm text-mc-text-secondary py-4 text-center">
          {waitingForFury ? (
            <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Waiting for Fury&apos;s first question…</span>
          ) : (
            <>No questions yet. Click <strong>Regenerate</strong> to ask Fury again.</>
          )}
        </div>
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
                      disabled={submitting || waitingForFury}
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
                        disabled={submitting || waitingForFury}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
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

          <div className="mt-4 pt-4 border-t border-mc-border flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveIdx(Math.max(0, activeIdx - 1))}
                disabled={activeIdx === 0 || submitting || waitingForFury}
                className="p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary disabled:opacity-30"
                aria-label="Previous question"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setActiveIdx(Math.min(total - 1, activeIdx + 1))}
                disabled={activeIdx === total - 1 || submitting || waitingForFury}
                className="p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary disabled:opacity-30"
                aria-label="Next question"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={submitAnswer}
              disabled={!selectedId || submitting || waitingForFury}
              className="flex items-center gap-1.5 px-5 min-h-9 rounded-lg bg-mc-accent text-mc-bg text-xs font-medium hover:bg-mc-accent/90 disabled:opacity-50"
            >
              {submitting || waitingForFury ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              {submitting ? 'Sending…' : waitingForFury ? 'Fury thinking…' : 'Save & Continue'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
