'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowPathIcon, BoltIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { usd0 as usd, type BudgetAgreement } from './budget-shared';

/**
 * The single way budget gets added.
 *
 * There used to be two buttons — "Add a line" by the grid and "Add Budget" in
 * the header — and which one you wanted depended on knowing that one made a
 * single row and the other made a repeating charge. That's an implementation
 * detail; the question a person actually has is "does this happen once, or
 * every month?". So it's one button and that question.
 *
 * Existing budgets are listed here too. Otherwise editing one needs a second
 * entry point, which is the two-button problem again in a different place.
 */
export function BudgetAddChooser({
  year,
  accountName,
  agreements,
  onOneTime,
  onRecurring,
  onEdit,
  onClose,
}: {
  year: number;
  accountName: string;
  agreements: BudgetAgreement[];
  onOneTime: () => void;
  onRecurring: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="animate-overlay-in fixed inset-0 z-[180] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={onClose}
    >
      <div
        className="animate-modal-in frost-heavy flex w-full max-w-lg flex-col overflow-hidden rounded-2xl shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Add budget</h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {accountName} · {year}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2 px-5 py-4">
          <Choice
            icon={<BoltIcon className="h-5 w-5" />}
            title="One-time"
            blurb="A single buy or a one-off charge. Goes on one month, or across a date range."
            onClick={onOneTime}
          />
          <Choice
            icon={<ArrowPathIcon className="h-5 w-5" />}
            title="Recurring"
            blurb="Charged every month of a term. Set the items once and lay out the year."
            onClick={onRecurring}
          />
        </div>

        {agreements.length > 0 && (
          <div className="border-t border-[var(--border)] bg-[var(--muted)]/25 px-5 py-3.5">
            <p className="text-[11px] font-medium text-[var(--muted-foreground)]">
              Or edit what&rsquo;s already set up
            </p>
            <div className="mt-2 space-y-1">
              {agreements.slice(0, 4).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={onEdit}
                  className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--muted)]/60"
                >
                  <span className="truncate text-xs text-[var(--foreground)]">{a.name}</span>
                  <span className="whitespace-nowrap text-[11px] tabular-nums text-[var(--muted-foreground)]">
                    {a.commitmentForYear == null ? '—' : usd(a.commitmentForYear)}
                  </span>
                </button>
              ))}
              {agreements.length > 4 && (
                <button
                  type="button"
                  onClick={onEdit}
                  className="px-2 py-1 text-[11px] text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
                >
                  and {agreements.length - 4} more…
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Choice({
  icon,
  title,
  blurb,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 px-4 py-3 text-left transition hover:border-[var(--primary)] hover:bg-[var(--primary)]/[0.07]"
    >
      <span className="mt-0.5 flex-shrink-0 text-[var(--muted-foreground)]">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--foreground)]">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-[var(--muted-foreground)]">
          {blurb}
        </span>
      </span>
    </button>
  );
}
