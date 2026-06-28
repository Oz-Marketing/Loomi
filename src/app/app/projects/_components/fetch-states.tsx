'use client';

/** Shared empty/loading/error blocks for the Projects list views so a fetch
 *  failure reads as an error (with retry), not an empty board. */

export function FetchError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
      <p className="text-sm text-[var(--foreground)]">Couldn&apos;t load tasks.</p>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">Something went wrong fetching this view.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] transition hover:bg-[var(--muted)]"
      >
        Retry
      </button>
    </div>
  );
}

export function FetchLoading() {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] py-16 text-center text-sm text-[var(--muted-foreground)]">
      Loading…
    </div>
  );
}
