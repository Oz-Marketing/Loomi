'use client';

import { useMemo } from 'react';
import type { AdData } from '@/lib/ad-generator/types';
import { calculatedRows } from '@/lib/ad-generator/offer-summary';

/**
 * Shows the work behind a custom offer's disclaimer.
 *
 * Shown for a MANUALLY-entered offer only. An OEM incentive carries the
 * manufacturer's own fine print, used verbatim — there is no arithmetic of ours
 * to check and nothing for a person to vouch for. A custom offer is the opposite:
 * a human typed the numbers, the disclaimer states figures derived from them, and
 * that person is the one who answers for it.
 *
 * So the card prints those figures WITH the arithmetic that produced them, rather
 * than asking the reader to trust a total.
 */
export function OfferSummaryCard({ data }: { data: AdData }) {
  const calculated = useMemo(() => calculatedRows(data), [data]);

  // Nothing derived yet — an empty card would just be noise on a form someone
  // has barely started.
  if (calculated.length === 0) return null;

  return (
    <section className="glass-card rounded-2xl border border-[var(--border)] p-5">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        Calculated for the disclaimer
      </h2>
      <div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
        {calculated.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 px-3 py-2">
            <span className="text-xs text-[var(--foreground)]">{row.label}</span>
            <span className="flex items-baseline gap-2 text-right">
              <span className="font-mono text-xs tabular-nums text-[var(--muted-foreground)]">
                {row.math}
              </span>
              <span className="font-mono text-xs font-semibold tabular-nums text-[var(--foreground)]">
                {row.value}
              </span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
        Worked out from the offer — these appear in the disclaimer exactly as shown.
      </p>
    </section>
  );
}
