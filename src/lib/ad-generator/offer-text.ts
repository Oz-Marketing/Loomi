import type { AdData } from './types';

/**
 * Structured offer model + deterministic offer-text assembly.
 *
 * Port of Oz Dealer Tools' `buildOfferParts()`: an offer has a TYPE plus typed
 * numbers, and the on-image offer block (label / big number / supporting line)
 * is assembled from them with consistent formatting. This is the DATA half of
 * the generator — the AI never writes these numbers, and later the disclaimer
 * token engine + OEM compliance rules bind to these same structured fields.
 */

export type OfferType = 'lease' | 'apr' | 'discount' | 'sales_price' | 'custom';

export const OFFER_TYPES: { value: OfferType; label: string }[] = [
  { value: 'lease', label: 'Lease' },
  { value: 'apr', label: 'APR Financing' },
  { value: 'discount', label: 'Discount / Cash Back' },
  { value: 'sales_price', label: 'Sales Price' },
  { value: 'custom', label: 'Custom (free text)' },
];

/** The assembled on-image offer block. */
export interface OfferBlock {
  /** Small label above the number (e.g. "PER MONTH LEASE"). */
  label: string;
  /** The big headline number, symbols included (e.g. "$299/mo", "1.9% APR"). */
  main: string;
  /** Supporting line(s), joined (e.g. "36-month lease · $2,999 due at signing"). */
  terms: string;
  /** The bare headline NUMBER only, no symbols (e.g. "299", "1.9", "40,000") — so
   *  the `$` prefix / `%` suffix can be their own styled, conditionally-shown
   *  elements (per the offer-block mockups). */
  value: string;
  /** Leading currency symbol for this offer type: "$" for money amounts, "" for
   *  APR (which carries a trailing "%" instead). */
  currency: string;
  /** Trailing rate symbol: "%" for APR, "" otherwise. */
  percent: string;
}

// ── formatting ──────────────────────────────────────────────────────────────

/** Parse a possibly-formatted numeric string ("$2,999", "1.9%") to a number. */
function num(v: string | undefined): number | null {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Format a value as USD (no cents by default), or null if not numeric. */
function money(v: string | undefined): string | null {
  const n = num(v);
  if (n == null) return null;
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** The bare number with thousands separators — NO currency/percent symbol (they
 *  render as separate elements). Keeps up to 2 decimals (APR rates like "1.9"). */
function plain(v: string | undefined): string | null {
  const n = num(v);
  if (n == null) return null;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function joinTerms(parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p && String(p).trim() !== '').join(' · ');
}

const PLACEHOLDER = '—';

const DEFAULT_LABEL: Record<Exclude<OfferType, 'custom' | 'discount'>, string> = {
  lease: 'PER MONTH LEASE',
  apr: 'APR',
  sales_price: 'SALES PRICE',
};

/**
 * Assemble the offer block from `data`. `offerLabel` (if set) overrides the
 * per-type default label. Returns null for `custom`, where the free-text
 * `price`/`terms` fields are used directly by the template.
 *
 * `prefix` reads a parallel set of fields (e.g. `'o2_'` → `o2_offerType`,
 * `o2_monthlyPayment`, …) so a dual-offer template can assemble a second offer
 * from the same engine. Default `''` is the original single-offer behavior.
 */
/**
 * Compute the `_offer*` (and `_o2_offer*`) display fields the doc templates bind
 * to, from the structured offer fields. Generic — runs for ANY TemplateDoc via
 * the renderer adapter — so the offer block shows everywhere a doc is rendered
 * (builder canvas, generator, gallery thumbs, snapshot copies, export), not just
 * the one hand-wired code template. A no-op for data without offer fields.
 */
export function enrichOfferFields(data: AdData): AdData {
  const out: AdData = { ...data };
  for (const prefix of ['', 'o2_'] as const) {
    // Only synthesize a block if this prefix's offer is actually in play.
    if (!(`${prefix}offerType` in data) && prefix !== '') continue;
    const offer = assembleOffer(data, prefix);
    out[`_${prefix}offerLabel`] = offer ? offer.label : data[`${prefix}offerLabel`] || 'PER MONTH LEASE';
    out[`_${prefix}offerMain`] = offer ? offer.main : data[`${prefix}price`] || '$299/mo';
    out[`_${prefix}offerTerms`] = offer ? offer.terms : data[`${prefix}terms`] || '';
    // Split pieces so the number + its $ / % symbol can be separate styled,
    // conditionally-shown elements (offer-block mockups).
    out[`_${prefix}offerValue`] = offer ? offer.value : data[`${prefix}price`] || '299';
    out[`_${prefix}offerCurrency`] = offer ? offer.currency : '';
    out[`_${prefix}offerPercent`] = offer ? offer.percent : '';
  }
  return out;
}

export function assembleOffer(data: AdData, prefix = ''): OfferBlock | null {
  const g = (key: string): string | undefined => data[prefix + key];
  const type = (g('offerType') as OfferType) || 'custom';
  if (type === 'custom') return null;

  const override = (g('offerLabel') || '').trim();
  const msrp = money(g('msrp'));

  switch (type) {
    case 'lease': {
      const pay = money(g('monthlyPayment'));
      const term = num(g('leaseTerm'));
      const due = money(g('dueAtSigning'));
      return {
        label: override || DEFAULT_LABEL.lease,
        main: pay ? `${pay}/mo` : PLACEHOLDER,
        value: plain(g('monthlyPayment')) ?? PLACEHOLDER,
        currency: '$',
        percent: '',
        terms: joinTerms([
          term != null ? `${term}-month lease` : null,
          due ? `${due} due at signing` : null,
        ]),
      };
    }
    case 'apr': {
      const rate = num(g('aprRate'));
      const term = num(g('aprTerm'));
      return {
        label: override || DEFAULT_LABEL.apr,
        main: rate != null ? `${rate}% APR` : PLACEHOLDER,
        value: plain(g('aprRate')) ?? PLACEHOLDER,
        currency: '',
        percent: '%',
        // Just the financing term — the financial institution still rides in the
        // disclaimer, but the on-image terms line stays clean.
        terms: joinTerms([term != null ? `for ${term} months` : null]),
      };
    }
    case 'discount': {
      const amt = money(g('discountAmount'));
      const cashBack = g('discountLabelStyle') === 'cash_back';
      return {
        label: override || (cashBack ? 'CASH BACK' : 'OFF MSRP'),
        main: amt ?? PLACEHOLDER,
        value: plain(g('discountAmount')) ?? PLACEHOLDER,
        currency: '$',
        percent: '',
        // Just the MSRP reference (the discount source rides in the disclaimer).
        terms: joinTerms([msrp ? `MSRP of ${msrp}` : null]),
      };
    }
    case 'sales_price': {
      const sale = money(g('salePrice'));
      return {
        label: override || DEFAULT_LABEL.sales_price,
        main: sale ?? PLACEHOLDER,
        value: plain(g('salePrice')) ?? PLACEHOLDER,
        currency: '$',
        percent: '',
        terms: joinTerms([msrp ? `MSRP of ${msrp}` : null]),
      };
    }
  }
  return null;
}
