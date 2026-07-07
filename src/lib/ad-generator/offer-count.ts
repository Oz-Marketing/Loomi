import type { AdData } from './types';
import type { DocElement } from './doc-types';

/**
 * Client-selectable offer count (1 or 2 offers on one template).
 *
 * A template that opts in (`doc.allowOfferCountChoice`) lets the client pick how
 * many offers the ad shows; the choice rides on `data._offerCount` ('1' | '2'),
 * a UI-driven convention field (like `data._sizes`) that flows untouched through
 * `enrichOfferFields` and every export route. Chrome elements are shown for both
 * counts; offer-block elements are tagged via `DocElement.offerCounts`. These
 * helpers resolve the effective count + per-element visibility, with back-compat
 * defaults so existing (untagged) dual templates keep rendering both offers.
 */

/** True when a binding reads the SECOND offer's fields (`o2_*` or the computed
 *  `_o2_*` display values). Used to default an untagged element to "2 offers
 *  only" so legacy dual templates work without a migration. */
function isSecondOfferElement(el: DocElement): boolean {
  const b = el.binding;
  if (!b || b.kind !== 'field') return false;
  return b.key.startsWith('o2_') || b.key.startsWith('_o2_');
}

/** The offer counts an element appears in, or `null` for "both". Explicit
 *  `el.offerCounts` wins; otherwise an `o2_`-bound element defaults to `[2]`. */
export function effectiveOfferCounts(el: DocElement): number[] | null {
  if (el.offerCounts && el.offerCounts.length) return el.offerCounts;
  return isSecondOfferElement(el) ? [2] : null;
}

/** How many offers the ad currently shows. Explicit `data._offerCount` wins;
 *  otherwise infer from whether a second offer is filled in (so existing dual
 *  ads, saved before this feature, still render as 2). */
export function effectiveOfferCount(data: AdData): number {
  const raw = typeof data._offerCount === 'string' ? Number(data._offerCount) : NaN;
  if (raw === 1 || raw === 2) return raw;
  return 'o2_offerType' in data ? 2 : 1;
}

/** Whether an element should render for the ad's current offer count. */
export function elementShownForCount(el: DocElement, data: AdData): boolean {
  const counts = effectiveOfferCounts(el);
  return !counts || counts.includes(effectiveOfferCount(data));
}
