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
  /** Small label above the number (e.g. "LEASE FOR"). */
  label: string;
  /** The big headline number (e.g. "$299/mo", "1.9% APR"). */
  main: string;
  /** Supporting line(s), joined (e.g. "36-month lease · $2,999 due at signing"). */
  terms: string;
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

function joinTerms(parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p && String(p).trim() !== '').join(' · ');
}

const PLACEHOLDER = '—';

const DEFAULT_LABEL: Record<Exclude<OfferType, 'custom' | 'discount'>, string> = {
  lease: 'LEASE FOR',
  apr: 'FINANCE AT',
  sales_price: 'SALE PRICE',
};

/**
 * Assemble the offer block from `data`. `offerLabel` (if set) overrides the
 * per-type default label. Returns null for `custom`, where the free-text
 * `price`/`terms` fields are used directly by the template.
 */
export function assembleOffer(data: AdData): OfferBlock | null {
  const type = (data.offerType as OfferType) || 'custom';
  if (type === 'custom') return null;

  const override = (data.offerLabel || '').trim();
  const msrp = money(data.msrp);

  switch (type) {
    case 'lease': {
      const pay = money(data.monthlyPayment);
      const term = num(data.leaseTerm);
      const due = money(data.dueAtSigning);
      return {
        label: override || DEFAULT_LABEL.lease,
        main: pay ? `${pay}/mo` : PLACEHOLDER,
        terms: joinTerms([
          term != null ? `${term}-month lease` : null,
          due ? `${due} due at signing` : null,
        ]),
      };
    }
    case 'apr': {
      const rate = num(data.aprRate);
      const term = num(data.aprTerm);
      return {
        label: override || DEFAULT_LABEL.apr,
        main: rate != null ? `${rate}% APR` : PLACEHOLDER,
        terms: joinTerms([
          term != null ? `for ${term} months` : null,
          data.financialInstitution ? `through ${data.financialInstitution}` : null,
        ]),
      };
    }
    case 'discount': {
      const amt = money(data.discountAmount);
      const cashBack = data.discountLabelStyle === 'cash_back';
      return {
        label: override || (cashBack ? 'CASH BACK' : 'SAVE'),
        main: amt ?? PLACEHOLDER,
        terms: joinTerms([
          msrp ? (cashBack ? `MSRP ${msrp}` : `Off MSRP ${msrp}`) : null,
          data.discountSource || null,
        ]),
      };
    }
    case 'sales_price': {
      const sale = money(data.salePrice);
      return {
        label: override || DEFAULT_LABEL.sales_price,
        main: sale ?? PLACEHOLDER,
        terms: joinTerms([msrp ? `MSRP ${msrp}` : null]),
      };
    }
  }
  return null;
}
