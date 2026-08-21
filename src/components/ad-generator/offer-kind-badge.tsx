'use client';

import { offerKindForDoc, type OfferKind } from '@/lib/ad-generator/offer-kinds';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';

/**
 * The offer-KIND badge on an ad or template card — Vehicle / Service / General.
 *
 * WHY IT EXISTS. A card showed its status and, for an edited ad, a grey "Custom"
 * chip meaning *"this ad keeps its own design, so template updates skip it"* —
 * a template-SYNC state. Nothing on the card said what kind of ad it was, and
 * "Custom" reads like an answer to that question while being about something
 * else entirely. (It collides twice over: the vehicle kind also has an offer
 * TYPE called `custom`.) Now the kind is stated explicitly, and the sync chip is
 * the only unlabelled one.
 *
 * Tinted per kind so a grid can be scanned by colour rather than read. The tones
 * live here — a kind shouldn't carry Tailwind classes — but each kind chooses
 * its own, so a new kind needs no edit to this file.
 */
/**
 * Every tone has to be distinct from the two NEUTRAL chips it sits beside — the
 * grey "Custom" sync chip and the grey draft status — and from the emerald
 * "ready" status. A slate tone was tried for `general` and read as just another
 * grey next to "Custom", which defeats the point of tinting at all.
 */
const TONES: Record<OfferKind['tone'], string> = {
  blue: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  violet: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
};

export function OfferKindBadge({ doc }: { doc?: Pick<TemplateDoc, 'offerKind'> | null }) {
  // A code-template ad has no doc snapshot. Every code template is a vehicle
  // offer, which is also what `offerKindForDoc` resolves an absent kind to — so
  // showing the badge is correct rather than a guess.
  const kind = offerKindForDoc(doc ?? {});
  return (
    <span
      title={kind.description}
      className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${TONES[kind.tone]}`}
    >
      {kind.shortLabel}
    </span>
  );
}
