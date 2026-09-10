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

import {
  OFFER_TYPES,
  OfferScopePicker,
  resolveScope,
  type GenerateCandidate,
} from './offer-scope-picker';

export { candidateKey, type GenerateCandidate } from './offer-scope-picker';

export function GenerateOffersModal({
  candidates,
  maxVehiclesPerRun,
  busy,
  onCancel,
  onGenerate,
}: {
  candidates: GenerateCandidate[];
  /** The account's vehicle cap — a run builds every permitted design for at most this many vehicles. */
  maxVehiclesPerRun: number;
  busy: boolean;
  onCancel: () => void;
  onGenerate: (scope: { vehicles: string[]; offerTypes: string[] }) => void;
}) {
  const [types, setTypes] = useState<string[]>([...OFFER_TYPES]);
  const [picked, setPicked] = useState<Set<string> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const { vehicles, total } = useMemo(() => resolveScope(candidates, types, picked), [candidates, types, picked]);
  const capped = Math.min(total, maxVehiclesPerRun);

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
              Builds every permitted design for each vehicle you pick and adds them to this account&apos;s campaign for
              the month. Where a model has several live offers, the best one wins — lease before APR before cash.
              Nothing publishes: every ad lands as a draft for review.
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
          <OfferScopePicker
            candidates={candidates}
            maxVehiclesPerRun={maxVehiclesPerRun}
            types={types}
            onTypesChange={setTypes}
            picked={picked}
            onPickedChange={setPicked}
          />
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
                vehicles,
                offerTypes: types,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <BoltIcon className={`h-3.5 w-3.5 ${busy ? 'animate-pulse' : ''}`} />
            {busy ? 'Generating…' : total === 0 ? 'Generate' : `Generate for ${capped} vehicle${capped === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(body, document.body);
}
