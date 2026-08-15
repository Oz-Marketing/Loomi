'use client';

import { useMemo, useState } from 'react';
import { toast } from '@/lib/toast';
import type { AdData } from '@/lib/ad-generator/types';
import { calculatedRows, boardValues, boardValuesText } from '@/lib/ad-generator/offer-summary';

/**
 * The custom-offer handoff card.
 *
 * Shown for a MANUALLY-entered offer only. An OEM incentive carries the
 * manufacturer's own fine print, used verbatim — there is no arithmetic of ours
 * to check and nothing for a person to vouch for. A custom offer is the opposite:
 * a human typed the numbers, the disclaimer states figures derived from them, and
 * that person is the one who answers for it.
 *
 * So the card does two things: it shows the derived figures WITH their arithmetic,
 * and it hands the offer off to the Monthly Offer board as text.
 */
export function OfferSummaryCard({
  data,
  disclaimer,
  missingFields = [],
}: {
  data: AdData;
  disclaimer: string;
  missingFields?: { key: string; label: string }[];
}) {
  const calculated = useMemo(() => calculatedRows(data), [data]);
  const board = useMemo(
    () => boardValues({ data, disclaimer, missingFields }),
    [data, disclaimer, missingFields],
  );

  // Nothing derived and no disclaimer yet — an empty card would just be noise on
  // a form someone has barely started.
  if (calculated.length === 0 && !disclaimer.trim()) return null;

  return (
    <section className="glass-card rounded-2xl border border-[var(--border)] p-5">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        Offer summary
      </h2>

      {calculated.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Calculated for the disclaimer
          </h3>
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
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Monthly Offer board
          </h3>
          <CopyButton label="Copy all" text={boardValuesText(board)} />
        </div>
        <div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
          {board.map((row) => (
            <div key={row.label} className="flex items-start gap-3 px-3 py-2">
              <span className="w-28 flex-shrink-0 text-[11px] text-[var(--muted-foreground)]">
                {row.label}
              </span>
              <span
                className={`min-w-0 flex-1 break-words text-xs text-[var(--foreground)] ${
                  row.label === 'Disclaimer' ? 'font-mono leading-relaxed' : ''
                }`}
              >
                {row.value}
              </span>
              <CopyButton text={row.value} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Copy a value, with the insecure-context fallback the app uses elsewhere. */
function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Could not copy to the clipboard.');
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={label ? undefined : 'Copy'}
      aria-label={label ?? 'Copy value'}
      className="flex-shrink-0 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
    >
      {copied ? 'Copied' : (label ?? 'Copy')}
    </button>
  );
}
