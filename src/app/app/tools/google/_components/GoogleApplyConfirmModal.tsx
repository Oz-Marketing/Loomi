'use client';

/**
 * Confirmation before a daily budget is written to Google (delivery/reallocation
 * spec §14).
 *
 * This is the ONE surface in the Google card that touches live spend, so no push
 * commits without the concrete change stated first: which campaign, current
 * daily → new daily, and the dollar delta. The same component serves the
 * per-campaign apply and the demoted apply-all — a batch is just the list with
 * more than one row in it, and showing the batch as a bare count ("push 6
 * changes?") is precisely the blind push this pattern exists to prevent.
 *
 * It states the change; it does not argue about it. The futile-raise note (§14)
 * rides along on rows where the raise will not move spend, because that is the
 * one thing someone would want to know at the moment of committing — but it
 * never disables the button. The human can still push it.
 */

import { XMarkIcon, ExclamationTriangleIcon, BoltIcon } from '@heroicons/react/24/outline';
import { COLORS } from '@/lib/ad-pacer/constants';
import { fmt } from '@/lib/ad-pacer/helpers';
import { Tooltip } from '@/app/app/tools/_shared';

export interface ApplyChange {
  id: string;
  name: string;
  currentDaily: number;
  newDaily: number;
  /** The raise will not increase spend — this campaign is not filling the cap
   *  it already has. Reallocation candidate, not an apply. */
  futile: boolean;
}

export function GoogleApplyConfirmModal({
  changes,
  pushing,
  onClose,
  onConfirm,
}: {
  changes: readonly ApplyChange[];
  pushing: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const single = changes.length === 1;
  const futileCount = changes.filter((c) => c.futile).length;
  const totalBefore = changes.reduce((s, c) => s + c.currentDaily, 0);
  const totalAfter = changes.reduce((s, c) => s + c.newDaily, 0);

  return (
    <div
      className="fixed inset-0 z-[140] flex items-start justify-center bg-black/50 p-4 backdrop-blur-sm sm:pt-24"
      onClick={onClose}
    >
      <div
        className="glass-modal flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-[var(--foreground)]">
              {single
                ? 'Set this daily budget in Google?'
                : `Set ${changes.length} daily budgets in Google?`}
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              This writes to the live account. Google re-paces over the following 24–48 hours, so
              spend will not match the new rate immediately.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <ul className="space-y-1.5">
            {changes.map((c) => {
              const delta = c.newDaily - c.currentDaily;
              const up = delta > 0;
              return (
                <li
                  key={c.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-[12px] font-semibold text-[var(--foreground)]">
                      {c.name}
                    </span>
                    <span className="tabular-nums text-[12px] text-[var(--muted-foreground)]">
                      {fmt(c.currentDaily)}/day →{' '}
                      <span className="font-bold text-[var(--foreground)]">
                        {fmt(c.newDaily)}/day
                      </span>
                    </span>
                    <span
                      className="ml-auto tabular-nums text-[11px] font-semibold"
                      style={{ color: up ? COLORS.warn : COLORS.success }}
                    >
                      {up ? '+' : '−'}
                      {fmt(Math.abs(delta))}/day
                    </span>
                  </div>
                  {c.futile && (
                    <Tooltip label="This is a mechanical spendability read, not a judgment about the campaign's performance. It says the campaign is not filling the budget it already has, so a bigger cap has nothing to bite on.">
                      <div
                        className="mt-1.5 flex cursor-help gap-1.5 text-[10px] leading-relaxed"
                        style={{ color: COLORS.warn }}
                      >
                        <ExclamationTriangleIcon className="mt-px h-3 w-3 flex-shrink-0" />
                        <span>
                          Unlikely to increase spend — this campaign is not spending the daily it
                          already has. Better handled as a move than a raise.
                        </span>
                      </div>
                    </Tooltip>
                  )}
                </li>
              );
            })}
          </ul>

          {!single && (
            <div className="mt-3 flex items-baseline justify-between rounded-lg bg-[var(--muted)]/40 px-3 py-2 text-[11px]">
              <span className="font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Daily total across these
              </span>
              <span className="tabular-nums text-[var(--foreground)]">
                {fmt(totalBefore)} →{' '}
                <span className="font-bold">{fmt(totalAfter)}</span>
              </span>
            </div>
          )}

          {futileCount > 0 && (
            <p className="mt-2.5 text-[10px] leading-relaxed text-[var(--muted-foreground)]">
              {futileCount === 1 ? 'One campaign' : `${futileCount} campaigns`} above cannot absorb
              the raise. Applying is not wrong — it simply will not move spend. Their budget is the
              money worth moving with the Move tool.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pushing || changes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <BoltIcon className="h-4 w-4" />
            {pushing ? 'Setting…' : single ? 'Set in Google' : `Set ${changes.length} in Google`}
          </button>
        </div>
      </div>
    </div>
  );
}
