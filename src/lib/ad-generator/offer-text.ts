import type { AdData } from './types';
import {
  CUSTOM_OFFER_TYPE_SPECS,
  VEHICLE_OFFER_TYPE_SPECS,
  type OfferFigureFormat,
  type OfferTypeSpec,
} from './offer-types';

/**
 * Structured offer model + deterministic offer-text assembly.
 *
 * Port of Oz Dealer Tools' `buildOfferParts()`: an offer has a TYPE plus typed
 * numbers, and the on-image offer block (label / big number / supporting line)
 * is assembled from them with consistent formatting. This is the DATA half of
 * the generator — the AI never writes these numbers, and later the disclaimer
 * token engine + OEM compliance rules bind to these same structured fields.
 *
 * The per-type rules themselves live in `offer-types.ts` as data; this module is
 * the INTERPRETER. It used to be a `switch` over the five vehicle types, which
 * doesn't survive a second offer kind — see docs/ad-generator-offer-kinds.md §4.1.
 */

/**
 * The vehicle kind's offer types. Deliberately still a closed literal union: it
 * IS closed (these five and no more), and several tables key off it
 * exhaustively — `BASELINE_REQUIRED`, `DEFAULT_DISCLAIMER_TEMPLATES`. Other
 * offer kinds declare their own types; they do not widen this one.
 */
export type OfferType = 'lease' | 'apr' | 'discount' | 'sales_price' | 'custom';

/** Picker options for the vehicle kind's Offer type dropdown, derived from the
 *  specs so the list and the assembly rules can never disagree. */
export const OFFER_TYPES: { value: OfferType; label: string }[] = VEHICLE_OFFER_TYPE_SPECS.map(
  (s) => ({ value: s.value as OfferType, label: s.label }),
);

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
  const cleaned = String(v).replace(/[^0-9.]/g, '');
  // No digits (e.g. a placeholder like "X,XXX") → not a number, so callers can
  // pass it through instead of coercing `Number("")` to 0.
  if (cleaned === '' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Format a Number as USD.
 *
 * CENTS ARE PRESERVED WHEN PRESENT: an integer renders as `$299`, a non-integer
 * as `$79.95`. Fixed-ops pricing is quoted in cents — the canonical oil-change
 * price is $79.95 — and the old `maximumFractionDigits: 0` rounded that to `$80`,
 * advertising a price the dealer does not charge.
 *
 * A non-empty, non-numeric value (a preview placeholder like "X,XXX", or
 * pre-formatted text) passes straight through with a "$", so the canvas can show
 * obvious placeholders. Null only when truly empty.
 *
 * The same rule is applied by the offer engine and the disclaimer engine, and it
 * has to stay that way: if only one rounded, the on-image price and the fine
 * print would state different numbers, which is worse than both rounding.
 */
function money(v: string | undefined): string | null {
  const n = num(v);
  if (n != null) {
  // Integer → no decimals (so a vehicle payment stays `$299`, unchanged).
  // Otherwise exactly two, because `$79.9` is not a way to write money.
  const digits = Number.isInteger(n) ? 0 : 2;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  const s = (v ?? '').trim();
  if (!s) return null;
  return s.startsWith('$') ? s : '$' + s;
}

/** The bare number with thousands separators — NO currency/percent symbol (they
 *  render as separate elements). Keeps up to 2 decimals (APR rates like "1.9").
 *  A non-numeric value (placeholder / pre-formatted) passes through unchanged. */
function plain(v: string | undefined): string | null {
  const n = num(v);
  if (n != null) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return (v ?? '').trim() || null;
}

function joinTerms(parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p && String(p).trim() !== '').join(' · ');
}

const PLACEHOLDER = '—';

/** Every offer type spec from every kind. One flat list — see `offerTypeSpec`. */
export const ALL_OFFER_TYPE_SPECS: OfferTypeSpec[] = [
  ...VEHICLE_OFFER_TYPE_SPECS,
  ...CUSTOM_OFFER_TYPE_SPECS,
];

/**
 * The spec for an offer type value, across every registered offer kind.
 *
 * Looked up by VALUE rather than per kind because `assembleOffer` only ever
 * receives `AdData` — a doc's offer kind isn't in scope by the time an offer is
 * assembled (the renderer, the launch kit and the copy service all call it with
 * data alone). Offer type values are therefore unique across kinds, which
 * `offer-kinds.test.ts` asserts: a `service` kind that reused `lease` would
 * silently assemble the vehicle one.
 */
export function offerTypeSpec(value: string): OfferTypeSpec | undefined {
  return ALL_OFFER_TYPE_SPECS.find((s) => s.value === value);
}

/**
 * Does this offer type mean "there is no offer on this ad"?
 *
 * True only for a type explicitly flagged `noOffer` — a hiring or event ad.
 * An UNKNOWN or empty type is false: the safe default is that there IS an offer,
 * because that is the reading under which manufacturer rules still get checked.
 *
 * Deliberately not "has no `main`": a vehicle free-text offer assembles nothing
 * either, but it is still an offer making manufacturer claims.
 */
export function isNoOfferType(value: string | undefined): boolean {
  return offerTypeSpec((value ?? '').trim())?.noOffer === true;
}

/** Format a figure the way `format` asks. Null when the value is truly empty. */
function formatFigure(v: string | undefined, format: OfferFigureFormat): string | null {
  if (format === 'money') return money(v);
  // `text` is a phrase, not a number — no thousands separators. `plain` would
  // rewrite "BUY 3 GET 1" untouched today but would mangle any headline that
  // happens to parse as a number.
  if (format === 'text') return (v ?? '').trim() || null;
  return plain(v);
}

/** The `currency` / `percent` symbol pair a headline format lights up. */
function symbolsFor(format: OfferFigureFormat): { currency: string; percent: string } {
  if (format === 'money') return { currency: '$', percent: '' };
  if (format === 'percent') return { currency: '', percent: '%' };
  return { currency: '', percent: '' };
}

/** The bare headline value, unformatted by currency/percent — what the separate
 *  `$` / `%` elements sit beside. A `text` headline is a phrase, so it passes
 *  through rather than being run through the number formatter. */
function bareValue(v: string | undefined, format: OfferFigureFormat): string | null {
  return format === 'text' ? (v ?? '').trim() || null : plain(v);
}

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
    out[`_${prefix}offerMain`] = offer ? offer.main : data[`${prefix}price`] || '$X,XXX/mo';
    out[`_${prefix}offerTerms`] = offer ? offer.terms : data[`${prefix}terms`] || '';
    // Split pieces so the number + its $ / % symbol can be separate styled,
    // conditionally-shown elements (offer-block mockups).
    out[`_${prefix}offerValue`] = offer ? offer.value : data[`${prefix}price`] || 'X,XXX';
    out[`_${prefix}offerCurrency`] = offer ? offer.currency : '';
    out[`_${prefix}offerPercent`] = offer ? offer.percent : '';
  }
  return out;
}

/**
 * Assemble the offer block from `data`. `offerLabel` (if set) overrides the
 * per-type default label. Returns null for `custom`, where the free-text
 * `price`/`terms` fields are used directly by the template.
 *
 * `prefix` reads a parallel set of fields (e.g. `'o2_'` → `o2_offerType`,
 * `o2_monthlyPayment`, …) so a dual-offer template can assemble a second offer
 * from the same engine. Default `''` is the original single-offer behavior.
 */
export function assembleOffer(data: AdData, prefix = ''): OfferBlock | null {
  const g = (key: string): string | undefined => data[prefix + key];
  const spec = offerTypeSpec(g('offerType') || 'custom');
  // No spec, or a spec with no headline figure (`custom`) → nothing to assemble;
  // the template uses the free-text `price` / `terms` fields instead.
  if (!spec?.main) return null;

  const override = (g('offerLabel') || '').trim();
  const swapped = spec.labelWhen ? spec.labelWhen.map[g(spec.labelWhen.field) ?? ''] : undefined;
  const figure = formatFigure(g(spec.main.field), spec.main.format);

  return {
    label: override || swapped || spec.defaultLabel || '',
    // A missing figure reads as the bare placeholder — never `—/mo`.
    main: figure ? `${figure}${spec.main.suffix ?? ''}` : PLACEHOLDER,
    // Always the bare number, whatever the headline format: the `$` / `%` are
    // separate styled elements.
    value: bareValue(g(spec.main.field), spec.main.format) ?? PLACEHOLDER,
    ...symbolsFor(spec.main.format),
    terms: joinTerms(
      (spec.terms ?? []).map((t) => {
        const v = formatFigure(g(t.field), t.format);
        return v ? t.text.replace('{value}', v) : null;
      }),
    ),
  };
}

/**
 * The headline field an offer type advertises — its `main` figure.
 *
 * The builder's compliance check treats this specially: a disclaimer element
 * discloses the fine print, but the headline AMOUNT has to be shown on its own.
 * Undefined for a type that assembles nothing.
 */
export function primaryOfferField(value: string): string | undefined {
  return offerTypeSpec(value)?.main?.field;
}

/**
 * Which underlying fields each computed `_offer*` token surfaces, per offer type.
 *
 * Derived from the type's spec rather than hand-listed. The builder needs it to
 * answer "is this required field actually visible on the artboard" — an element
 * bound to `_offerMain` surfaces the headline field, one bound to `_offerTerms`
 * surfaces every field the terms lines read.
 */
export function offerTokenFields(value: string): Record<string, string[]> {
  const spec = offerTypeSpec(value);
  if (!spec?.main) return {};
  const main = [spec.main.field];
  return {
    _offerMain: main,
    _offerValue: main,
    _offerTerms: (spec.terms ?? []).map((t) => t.field),
  };
}
