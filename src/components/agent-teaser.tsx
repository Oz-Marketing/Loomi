'use client';

/**
 * The nudge beside the floating bubble — "Ask me about co-op".
 *
 * Appears a beat after you land on a page a specialist owns, cycles through a few
 * questions worth asking there, and goes away for good once dismissed.
 *
 * Three restraints, because an assistant that nags is one people learn to ignore:
 *
 *  - It only appears where a specialist is genuinely relevant (see `page-hints`).
 *  - Dismissing it is remembered per specialist, in localStorage. Not per page —
 *    "I've seen this" is a fact about the agent, not about the URL.
 *  - It never steals focus and never blocks the bubble underneath it.
 *
 * Every animation is behind `motion-safe:`, so a reduced-motion preference gets the
 * same copy without the movement.
 */

import { useEffect, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { agentIdentity } from '@/lib/ai/specialists/identity';
import { rotatingExample, type PageHint } from '@/lib/ai/specialists/page-hints';
import { AgentAvatar } from './agent-avatar';

/** Wait before appearing: long enough that the page has settled, short enough to be seen. */
const APPEAR_DELAY_MS = 1200;
/** How long each example stays up. */
const ROTATE_MS = 4600;

function dismissKey(specialist: string) {
  return `loomi:agent-teaser-dismissed:${specialist}`;
}

export function AgentTeaser({
  hint,
  onAsk,
  /** Preview/testing escape hatch: skip the delay and ignore the dismissal record. */
  forceVisible = false,
}: {
  hint: PageHint;
  onAsk: (question: string) => void;
  forceVisible?: boolean;
}) {
  const [visible, setVisible] = useState(forceVisible);
  const [index, setIndex] = useState(0);

  const identity = agentIdentity(hint.specialist);

  useEffect(() => {
    if (forceVisible) return;
    try {
      if (localStorage.getItem(dismissKey(hint.specialist))) return;
    } catch {
      // Private mode / storage disabled — showing the teaser is the safe default.
    }
    const t = setTimeout(() => setVisible(true), APPEAR_DELAY_MS);
    return () => clearTimeout(t);
  }, [hint.specialist, forceVisible]);

  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => setIndex((i) => i + 1), ROTATE_MS);
    return () => clearInterval(t);
  }, [visible]);

  if (!visible) return null;

  const example = rotatingExample(hint, index);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(dismissKey(hint.specialist), '1');
    } catch {
      // Nothing to do — it reappears next session, which is acceptable.
    }
  }

  return (
    <div
      className={
        'pointer-events-auto w-[19rem] max-w-[calc(100vw-3rem)] rounded-2xl border ' +
        'border-[var(--border)] bg-[var(--card-strong)] p-3 shadow-xl backdrop-blur ' +
        'motion-safe:animate-[teaser-in_320ms_ease-out]'
      }
      style={{ boxShadow: `0 10px 40px -12px color-mix(in srgb, ${identity.accent} 35%, transparent)` }}
    >
      <div className="flex items-start gap-2.5">
        <AgentAvatar identity={identity} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-[var(--foreground)]">
            {hint.teaser}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
            {identity.name} · {identity.role}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={`Dismiss ${identity.name}'s suggestion`}
          className="rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
        >
          <XMarkIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* The rotating question. Keyed so each one animates in on its own. */}
      <button
        key={example}
        type="button"
        onClick={() => onAsk(example)}
        className={
          'mt-2.5 w-full rounded-xl border border-[var(--border)] bg-[var(--muted)] ' +
          'px-3 py-2 text-left text-[12px] leading-snug text-[var(--foreground)] ' +
          'transition-colors hover:border-[var(--ring)] ' +
          'motion-safe:animate-[teaser-swap_300ms_ease-out]'
        }
      >
        <span className="text-[var(--muted-foreground)]">“</span>
        {example}
        <span className="text-[var(--muted-foreground)]">”</span>
      </button>

      {/* Which of the examples is showing. Purely orientation — not interactive. */}
      <div className="mt-2 flex justify-center gap-1" aria-hidden="true">
        {hint.examples.map((q, i) => (
          <span
            key={q}
            className="h-1 w-1 rounded-full transition-colors"
            style={{
              background:
                i === index % hint.examples.length
                  ? identity.accent
                  : 'var(--border)',
            }}
          />
        ))}
      </div>
    </div>
  );
}
