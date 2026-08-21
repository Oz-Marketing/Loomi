'use client';

/**
 * Error boundary for the app tree.
 *
 * There was none, so an unhandled render error fell through to Next's built-in
 * page: an unstyled wall of text in dev, and a bare "Application error: a
 * client-side exception has occurred" in production — no branding, no way back,
 * and nothing for the user to quote when they report it.
 *
 * `reset()` re-renders the segment without a full page load, which is the right
 * first thing to try: a good share of these are a transient fetch failure
 * during render rather than a genuinely broken page.
 *
 * The digest is Next's own hash of the server-side error, and it is the ONLY
 * link between what the user saw and the stack in the server log — production
 * builds deliberately withhold the message. Showing it is what makes a bug
 * report actionable.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowPathIcon, HomeIcon } from '@heroicons/react/24/outline';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Goes to the browser console in production too, where the message is
    // otherwise stripped from the rendered page.
    console.error('[app-error]', error);
  }, [error]);

  return (
    <section className="relative flex min-h-[calc(100vh-9rem)] items-center justify-center py-10 sm:py-14">
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-72 w-[min(92vw,52rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.28)_0%,rgba(99,102,241,0.14)_30%,rgba(56,100,220,0.08)_52%,transparent_74%)] blur-3xl" />

      <div className="glass-card animate-fade-in-up relative w-full max-w-2xl overflow-hidden rounded-3xl p-7 sm:p-10">
        <div className="animate-fade-in-up animate-stagger-2 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] backdrop-blur-xl">
          <span className="iris-rainbow-gradient h-2 w-2 rounded-full" />
          Something went wrong
        </div>

        <h1 className="animate-fade-in-up animate-stagger-3 mt-6 max-w-xl text-3xl font-bold leading-tight tracking-tight text-[var(--foreground)] sm:text-4xl">
          This page didn&rsquo;t load.
        </h1>

        <p className="animate-fade-in-up animate-stagger-4 mt-4 max-w-xl text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
          The error has been logged. Trying again often works &mdash; if it
          doesn&rsquo;t, your dashboard is still there.
        </p>

        <div className="animate-fade-in-up animate-stagger-5 mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] shadow-[0_8px_30px_rgba(99,102,241,0.35)] transition hover:brightness-110"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
          >
            <HomeIcon className="h-4 w-4" />
            Go to Dashboard
          </Link>
        </div>

        {error.digest && (
          <p className="animate-fade-in-up animate-stagger-6 mt-7 text-xs text-[var(--muted-foreground)]">
            Reporting this? Include reference{' '}
            <code className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono">
              {error.digest}
            </code>
            .
          </p>
        )}
      </div>
    </section>
  );
}
