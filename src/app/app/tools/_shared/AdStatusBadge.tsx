'use client';

// Read-only platform "Ad Status" pill — the campaign's actual delivery status
// from Meta/Google, normalized. Display-only; never editable (the team edits
// Task Status instead). Used in the editor modal and the pacer card.

import { COLORS } from '@/lib/ad-pacer/constants';
import { normalizeAdStatus, adStatusTone } from '@/lib/ad-pacer/platform-status';
import type { PacerAd } from '@/lib/ad-pacer/types';

const TONE_COLOR: Record<ReturnType<typeof adStatusTone>, string> = {
  good: COLORS.success,
  warn: COLORS.warn,
  bad: COLORS.error,
  muted: 'var(--muted-foreground)',
};

export function AdStatusBadge({
  ad,
  label = false,
}: {
  ad: PacerAd;
  /** Prefix with a muted "Ad Status" caption (for the editor field). */
  label?: boolean;
}) {
  const status = normalizeAdStatus(ad);
  const color = TONE_COLOR[adStatusTone(status)];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px]">
      {label && (
        <span className="font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Ad Status
        </span>
      )}
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: color }} />
      <span style={{ color }}>{status}</span>
    </span>
  );
}
