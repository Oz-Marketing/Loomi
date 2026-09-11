'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, CheckIcon } from '@heroicons/react/24/outline';
import {
  CHANNEL_QUESTION_KEY,
  type CampaignIntakeAnswer,
  type CampaignIntakeQuestion,
} from '@/lib/ai/campaign-intake';

/**
 * The interview between the opening line and the plan — one question a screen.
 *
 * All of the questions arrive at once from the intake call, so moving between
 * them is instant; nothing here waits on the model. A single-choice answer
 * advances on its own after a beat, which is long enough to see the check land
 * and short enough that four questions take four taps.
 */
export function CampaignIntakeInterview({
  questions,
  onBack,
  onDone,
  submitting,
}: {
  questions: CampaignIntakeQuestion[];
  /** Leaving question one — back to the opening line. */
  onBack: () => void;
  onDone: (result: { answers: CampaignIntakeAnswer[]; channels: string[] }) => void;
  submitting: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
  }, []);

  const q = questions[index];
  const last = index === questions.length - 1;
  if (!q) return null;

  const chosen = picked[q.key] ?? [];
  const free = (other[q.key] ?? '').trim();
  const answered = chosen.length > 0 || free.length > 0;

  const goNext = () => {
    if (last) {
      onDone(collect(questions, picked, other));
      return;
    }
    setIndex((i) => Math.min(i + 1, questions.length - 1));
  };

  const goBack = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (index === 0) onBack();
    else setIndex((i) => i - 1);
  };

  const choose = (value: string) => {
    if (q.kind === 'multi') {
      setPicked((p) => {
        const cur = p[q.key] ?? [];
        return { ...p, [q.key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
      });
      return;
    }
    setPicked((p) => ({ ...p, [q.key]: [value] }));
    // Single choice moves on by itself — but not from the last question, where
    // the next step spends money on a model call.
    if (!last) {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      advanceTimer.current = setTimeout(() => setIndex((i) => Math.min(i + 1, questions.length - 1)), 180);
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          <span>
            Question {index + 1} of {questions.length}
          </span>
          {q.optional && <span>Optional</span>}
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--muted)]">
          <div
            className="iris-rainbow-gradient h-full rounded-full transition-all duration-300"
            style={{ width: `${((index + 1) / questions.length) * 100}%` }}
          />
        </div>
      </div>

      <div key={q.key} className="animate-fade-in-up">
        <h1 className="text-xl font-bold tracking-tight">{q.question}</h1>
        {q.help && <p className="mt-1 text-sm text-[var(--muted-foreground)]">{q.help}</p>}

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {q.options.map((o) => {
            const on = chosen.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => choose(o.value)}
                aria-pressed={on}
                className={`flex items-start justify-between gap-2 rounded-xl border p-3 text-left transition ${
                  on
                    ? 'border-[var(--primary)] bg-[var(--primary)]/10'
                    : 'border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)]'
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[var(--foreground)]">{o.label}</span>
                  {o.hint && (
                    <span className="mt-0.5 block text-[11px] leading-snug text-[var(--muted-foreground)]">
                      {o.hint}
                    </span>
                  )}
                </span>
                {on && <CheckIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--primary)]" />}
              </button>
            );
          })}
        </div>

        {q.allowOther && (
          <input
            value={other[q.key] ?? ''}
            onChange={(e) => setOther((o) => ({ ...o, [q.key]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && answered) goNext();
            }}
            placeholder="Something else…"
            className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--card-strong)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]/60"
          />
        )}
      </div>

      <div className="mt-8 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={goBack}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] disabled:opacity-50"
        >
          <ArrowLeftIcon className="h-4 w-4" /> Back
        </button>
        <div className="flex items-center gap-3">
          {q.optional && !answered && (
            <button
              type="button"
              onClick={goNext}
              disabled={submitting}
              className="text-sm font-medium text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] disabled:opacity-50"
            >
              Skip
            </button>
          )}
          <button
            type="button"
            onClick={goNext}
            disabled={(!answered && !q.optional) || submitting}
            className={
              last
                ? 'iris-rainbow-gradient inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
                : 'inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-5 py-2 text-sm font-semibold text-[var(--primary-foreground)] shadow-sm transition hover:bg-[var(--primary)]/90 disabled:cursor-not-allowed disabled:opacity-50'
            }
          >
            {last ? (submitting ? 'Drafting…' : 'Draft the plan') : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Answers as the plan route wants them: the question text and the labels chosen. */
function collect(
  questions: CampaignIntakeQuestion[],
  picked: Record<string, string[]>,
  other: Record<string, string>,
): { answers: CampaignIntakeAnswer[]; channels: string[] } {
  const answers: CampaignIntakeAnswer[] = [];
  for (const q of questions) {
    if (q.key === CHANNEL_QUESTION_KEY) continue;
    const labels = (picked[q.key] ?? []).map((v) => q.options.find((o) => o.value === v)?.label ?? v);
    const free = (other[q.key] ?? '').trim();
    if (free) labels.push(free);
    if (labels.length) answers.push({ question: q.question, answers: labels });
  }
  return { answers, channels: picked[CHANNEL_QUESTION_KEY] ?? [] };
}
