import { offerTypeSpec } from './offer-text';

/**
 * The colour and the short name an offer type is drawn with.
 *
 * WHY THIS IS SEPARATE from `OfferTypeSpec`. A spec says how an offer ASSEMBLES —
 * which field is the figure, what the terms read, what is required. A colour says
 * nothing about the offer; it is a decision about the interface. Keeping them apart
 * means the specs stay readable as compliance-relevant declarations, and a designer
 * re-tinting the palette never edits a file that decides what a lease ad says.
 *
 * WHY IT IS SHARED. The tint is a claim of identity: violet means APR on the
 * canvas's preview tabs, on the variable-picker pills and on the proof sheet's
 * rows. When the palette lived in the builder page, the proof sheet had to restate
 * it, and two copies of a claim of identity is one bug waiting for the day
 * somebody adds a fifth type.
 *
 * An unknown type gets the neutral slate rather than throwing — a doc may name a
 * type from a kind that has since been retired, and a grey pill is the right way
 * to render one.
 */

const NEUTRAL = '#64748b'; // slate — "no particular type"

/** Accent per offer type. Values are the offer type ids, not labels. */
const ACCENT: Record<string, string> = {
  // Vehicle kind.
  lease: '#3b82f6', // blue
  apr: '#8b5cf6', // violet
  discount: '#f59e0b', // amber
  sales_price: '#10b981', // emerald
  custom: NEUTRAL,
  // Custom kind. Deliberately reuses the vehicle hues by shape of offer — a
  // percentage is amber wherever it appears — so the palette reads as one system.
  flat_price: '#10b981',
  percent_off: '#f59e0b',
  dollar_off: '#f59e0b',
  other_offer: '#8b5cf6',
  no_offer: NEUTRAL,
};

/**
 * Short names, for a pill or a tab where the full label won't fit.
 *
 * Only types whose `label` is too long to draw at 9–11px need an entry; everything
 * else falls back to the spec's own label, so a new offer type is legible without
 * an edit here.
 */
const SHORT: Record<string, string> = {
  apr: 'APR',
  // "Discount / Cash Back" is the picker's label — the slash reads as two things
  // in a pill this small, and the type is one thing.
  discount: 'Discount',
  sales_price: 'Sale price',
  custom: 'Custom',
  other_offer: 'BOGO / bundle',
  no_offer: 'No offer',
};

/** The offer type's accent colour. Slate for anything unrecognised. */
export function offerTypeAccent(value: string | undefined): string {
  return (value && ACCENT[value]) || NEUTRAL;
}

/** The offer type's short name — its label when that is already short enough. */
export function offerTypeShort(value: string | undefined): string {
  if (!value) return 'Any';
  return SHORT[value] ?? offerTypeSpec(value)?.label ?? value;
}

/** Accent, plus the translucent border/fill derived from it, for a pill. */
export function offerTypePill(value: string | undefined): {
  color: string;
  borderColor: string;
  backgroundColor: string;
} {
  const color = offerTypeAccent(value);
  return { color, borderColor: `${color}66`, backgroundColor: `${color}1f` };
}
