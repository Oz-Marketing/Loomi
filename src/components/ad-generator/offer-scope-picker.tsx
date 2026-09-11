'use client';

/**
 * The scope of one OEM offer run: which offer types, which vehicles.
 *
 * Extracted from `GenerateOffersModal` so the Campaigns wizard and the Ad
 * Generator's dialog show the SAME list with the same rules — two pickers is
 * how "which vehicles will this build" gets answered differently on two pages.
 *
 * Controlled: the parent owns `types` and `picked` so a Review step can read
 * the selection back. `resolveScope` turns those into what the run wants.
 */
import { useMemo } from 'react';

export const TYPE_LABEL: Record<string, string> = {
  lease: 'Lease',
  apr: 'APR',
  cash: 'Cash / discount',
};

/** The offer types generation can select. Mirrors `SelectableOfferType`. */
export const OFFER_TYPES = ['lease', 'apr', 'cash'] as const;

export interface GenerateCandidate {
  year: number;
  make: string;
  model: string;
  stock: number;
  offerTypes: string[];
  wouldChoose: string | null;
  wouldChooseType: string | null;
  /** Latest end date across the vehicle's live offers (yyyy-mm-dd). */
  latestEnd?: string | null;
}

/** The group key `generateForAccount` matches against. Must stay in step with it. */
export const candidateKey = (c: GenerateCandidate) =>
  `${c.year}|${c.make.toLowerCase()}|${c.model.toLowerCase()}`;

/**
 * What the current selection means for the run.
 *
 * `picked === null` is "everything eligible", which keeps following the type
 * filter; a concrete Set is a choice worth preserving — intersected with what is
 * eligible so unticking a type can't leave a hidden vehicle queued.
 */
export function resolveScope(candidates: GenerateCandidate[], types: string[], picked: Set<string> | null) {
  const eligible = candidates.filter((c) => c.offerTypes.some((t) => types.includes(t)));
  const eligibleKeys = new Set(eligible.map(candidateKey));
  const selected = picked ? new Set([...picked].filter((k) => eligibleKeys.has(k))) : eligibleKeys;
  return { eligible, selected, vehicles: [...selected], offerTypes: types, total: selected.size };
}

function endsLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return `Ends ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

export function OfferScopePicker({
  candidates,
  maxVehiclesPerRun,
  types,
  onTypesChange,
  picked,
  onPickedChange,
}: {
  candidates: GenerateCandidate[];
  /** The account's vehicle cap — a run builds every permitted design for at most this many vehicles. */
  maxVehiclesPerRun: number;
  types: string[];
  onTypesChange: (types: string[]) => void;
  picked: Set<string> | null;
  onPickedChange: (picked: Set<string> | null) => void;
}) {
  const { eligible, selected, total } = useMemo(
    () => resolveScope(candidates, types, picked),
    [candidates, types, picked],
  );

  function toggleVehicle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onPickedChange(next);
  }
  function toggleType(t: string) {
    onTypesChange(types.includes(t) ? types.filter((x) => x !== t) : [...types, t]);
  }

  return (
    <div>
      <div className="mb-4">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Offer types
        </div>
        <div className="flex flex-wrap gap-1.5">
          {OFFER_TYPES.map((t) => {
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
        {types.length === 0 && <p className="mt-1.5 text-[11px] text-amber-500">Pick at least one offer type.</p>}
      </div>

      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Vehicles
        </span>
        <div className="flex items-center gap-2 text-[11px]">
          <button type="button" onClick={() => onPickedChange(null)} className="font-medium text-[var(--primary)] hover:underline">
            Select all
          </button>
          <span className="text-[var(--muted-foreground)]">·</span>
          <button
            type="button"
            onClick={() => onPickedChange(new Set())}
            className="font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            None
          </button>
        </div>
      </div>

      {eligible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted-foreground)]">
          No in-stock vehicle has a live offer of the selected type{types.length === 1 ? '' : 's'}.
        </p>
      ) : (
        <div className="space-y-1">
          {eligible.map((c) => {
            const key = candidateKey(c);
            const on = selected.has(key);
            // Most GM models carry a lease AND an APR program, so turning a type
            // off rarely removes a vehicle — it changes which offer it
            // advertises. Promising "$299/mo" after leases were excluded would be
            // wrong, so fall back to naming what's left; which of those wins is
            // the account's priority order, decided server-side.
            const offer =
              c.wouldChooseType && types.includes(c.wouldChooseType) && c.wouldChoose
                ? c.wouldChoose
                : (() => {
                    const left = c.offerTypes.filter((t) => types.includes(t));
                    return left.length ? `${left.map((t) => TYPE_LABEL[t] ?? t).join(' or ')} offer` : '';
                  })();
            const ends = endsLabel(c.latestEnd);
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
                      <path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-[var(--foreground)]">
                    {c.year} {c.make} {c.model}
                  </span>
                  <span className="block text-[11px] text-[var(--muted-foreground)]">
                    {c.stock} in stock
                    {offer ? ` · ${offer}` : ''}
                    {ends ? ` · ${ends}` : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {total > maxVehiclesPerRun && (
        <p className="mt-3 text-[11px] text-amber-500">
          The run cap is {maxVehiclesPerRun} vehicle{maxVehiclesPerRun === 1 ? '' : 's'}; {total} are selected, so{' '}
          {total - maxVehiclesPerRun} will be left out. Raise <strong>Max vehicles per run</strong> in Ad Automation
          settings.
        </p>
      )}
    </div>
  );
}
