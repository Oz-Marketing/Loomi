'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BoltIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { HelpTip } from '@/components/ui/help-tip';

/**
 * Scope picker for "Generate from OEM offers".
 *
 * Generating used to fire straight off the menu and build up to `maxAdsPerRun`
 * drafts across every in-stock model. That's a big, opinionated side effect for
 * one click — the usual want is a slice of it (this month's lease push, two
 * models), and getting that by editing the saved automation settings would
 * leave the sub-account misconfigured afterwards. So the narrowing happens
 * here, per run, and nothing persists.
 *
 * The list is the real candidate set from the automation report, so you can see
 * exactly what you'd get — including which offer each vehicle would advertise
 * under the current selection (see `selectOffer` for the ranking itself).
 */

const TYPE_LABEL: Record<string, string> = {
  lease: 'Lease',
  apr: 'APR',
  cash: 'Cash / discount',
};

/** The offer types generation can select. Mirrors `SelectableOfferType`. */
const TYPES = ['lease', 'apr', 'cash'] as const;

export interface GenerateCandidate {
  year: number;
  make: string;
  model: string;
  stock: number;
  offerTypes: string[];
  wouldChoose: string | null;
  wouldChooseType: string | null;
}

/** The group key `generateForAccount` matches against. Must stay in step with it. */
export const candidateKey = (c: GenerateCandidate) =>
  `${c.year}|${c.make.toLowerCase()}|${c.model.toLowerCase()}`;

export function GenerateOffersModal({
  candidates,
  maxAdsPerRun,
  busy,
  onCancel,
  onGenerate,
}: {
  candidates: GenerateCandidate[];
  maxAdsPerRun: number;
  busy: boolean;
  onCancel: () => void;
  onGenerate: (scope: { vehicles: string[]; offerTypes: string[] }) => void;
}) {
  const [types, setTypes] = useState<string[]>([...TYPES]);
  // null = "everything eligible", which keeps following the type filter as it
  // changes. A concrete Set means the user has made a choice worth preserving.
  const [picked, setPicked] = useState<Set<string> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  /** A vehicle is eligible when it has a live offer of one of the chosen types. */
  const eligible = useMemo(
    () => candidates.filter((c) => c.offerTypes.some((t) => types.includes(t))),
    [candidates, types],
  );
  const eligibleKeys = useMemo(() => new Set(eligible.map(candidateKey)), [eligible]);

  // Selection is always intersected with what's currently eligible, so
  // unticking a type can't leave a hidden vehicle queued for generation.
  const selected = useMemo(
    () => (picked ? new Set([...picked].filter((k) => eligibleKeys.has(k))) : eligibleKeys),
    [picked, eligibleKeys],
  );

  const total = selected.size;
  const capped = Math.min(total, maxAdsPerRun);

  function toggleVehicle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  }

  function toggleType(t: string) {
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  const body = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={() => !busy && onCancel()} />
      <div className="relative flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-5">
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-semibold text-[var(--foreground)]">Generate from OEM offers</h2>
              <HelpTip title="How the offer is picked" iconClassName="h-3.5 w-3.5">
                <p>A model usually has several live manufacturer offers at once — a lease <em>and</em> a finance rate, say. One ad can only show one, so they&apos;re ranked:</p>
                <ol>
                  <li>Offers that expire before your planning window are dropped.</li>
                  <li>So is any type you&apos;ve switched off above.</li>
                  <li>Of what&apos;s left, <strong>type order decides</strong> — lease, then APR, then cash.</li>
                  <li>Within a type, the strongest number wins: lowest monthly payment, lowest APR (longer term breaking a tie), or largest cash amount.</li>
                </ol>
                <p>The offer shown against each vehicle below is the winner under your current selection.</p>
              </HelpTip>
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Builds one draft per vehicle you pick. Where a model has several live offers, the best one wins —
              lease before APR before cash. Nothing publishes: every ad lands as a draft for review.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Offer types
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TYPES.map((t) => {
                const on = types.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleType(t)}
                    aria-pressed={on}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      on
                        ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                        : 'border border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]'
                    }`}
                  >
                    {TYPE_LABEL[t]}
                  </button>
                );
              })}
            </div>
            {types.length === 0 && (
              <p className="mt-1.5 text-[11px] text-amber-500">Pick at least one offer type.</p>
            )}
          </div>

          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Vehicles
            </span>
            <div className="flex items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="font-medium text-[var(--primary)] hover:underline"
              >
                Select all
              </button>
              <span className="text-[var(--muted-foreground)]">·</span>
              <button
                type="button"
                onClick={() => setPicked(new Set())}
                className="font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                None
              </button>
            </div>
          </div>

          {eligible.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted-foreground)]">
              No in-stock vehicle has a live offer of the selected type
              {types.length === 1 ? '' : 's'}.
            </p>
          ) : (
            <div className="space-y-1">
              {eligible.map((c) => {
                const key = candidateKey(c);
                const on = selected.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleVehicle(key)}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:bg-[var(--muted)]/40"
                  >
                    <span
                      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                        on ? 'border-[var(--primary)] bg-[var(--primary)]' : 'border-[var(--border)]'
                      }`}
                    >
                      {on && (
                        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none">
                          <path
                            d="M2.5 6.5l2.5 2.5 4.5-5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-[var(--foreground)]">
                        {c.year} {c.make} {c.model}
                      </span>
                      <span className="block text-[11px] text-[var(--muted-foreground)]">
                        {c.stock} in stock
                        {(() => {
                          // Most GM models carry a lease AND an APR programme, so
                          // turning a type off rarely removes a vehicle — it
                          // changes which offer it advertises. Promising
                          // "$299/mo" after leases were excluded would be wrong,
                          // so fall back to naming what's left. Which of those
                          // wins is the account's priority order, decided
                          // server-side, so don't guess at it here.
                          if (c.wouldChooseType && types.includes(c.wouldChooseType) && c.wouldChoose) {
                            return ` · ${c.wouldChoose}`;
                          }
                          const left = c.offerTypes.filter((t) => types.includes(t));
                          if (!left.length) return '';
                          return ` · ${left.map((t) => TYPE_LABEL[t] ?? t).join(' or ')} offer`;
                        })()}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {total > maxAdsPerRun && (
            <p className="mt-3 text-[11px] text-amber-500">
              The run cap is {maxAdsPerRun} ad{maxAdsPerRun === 1 ? '' : 's'}, so only the first{' '}
              {maxAdsPerRun} of your {total} will be built. Raise it in Automation → Settings.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] p-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || total === 0 || types.length === 0}
            onClick={() =>
              onGenerate({
                // Send the explicit list even when it's "everything": the report
                // and the generator read the same snapshots, but a poll landing
                // between them shouldn't silently widen the run.
                vehicles: [...selected],
                offerTypes: types,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <BoltIcon className={`h-3.5 w-3.5 ${busy ? 'animate-pulse' : ''}`} />
            {busy ? 'Generating…' : total === 0 ? 'Generate' : `Generate ${capped} ad${capped === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(body, document.body);
}
