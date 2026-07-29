import { createHash } from 'node:crypto';
import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';

/**
 * Offer fingerprinting — the identity the entire change-detection design rests on.
 *
 * "Is this a NEW offer?" is answered by comparing fingerprints between polls, so
 * a fingerprint that is too volatile invents offers that don't exist, and one
 * that is too loose misses real programme changes. Both failure modes are
 * expensive: the first spams drafts, the second means a dealer runs last month's
 * payment.
 *
 * So we hash ONLY the structured, numeric shape of the offer. Deliberately
 * EXCLUDED:
 *   - `id` — MarketCheck frequently omits it, and it is not stable across pulls.
 *   - `description` / `offerDetails` / `eligibility` / `programName` — prose. The
 *     feed rewords the same programme between refreshes (spacing, casing, order),
 *     which would read as a brand-new offer every time.
 *   - `startDate` — backfilled inconsistently; the end date is what governs an ad.
 *
 * Money is rounded to whole dollars and rates to 2dp before hashing, so a feed
 * that reports 318 one day and 318.0000001 the next doesn't churn.
 */

/** The normalized shape that actually gets hashed — also useful for debugging
 *  a "why did this change?" question in a run log. */
export interface OfferIdentity {
  type: string;
  payment: number;
  term: number;
  downPayment: number;
  rate: number;
  amount: number;
  msrp: number;
  trim: string;
  /** ISO yyyy-mm-dd, or '' when the feed gives no parseable end date. */
  endDate: string;
}

/** Whole dollars — sub-dollar jitter in the feed must not read as a new offer. */
function money(n: number): number {
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Rates to 2dp (1.9, 0.9, 4.99). */
function rate(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/**
 * Normalize a feed end date to `yyyy-mm-dd`. MarketCheck mixes formats — we've
 * observed both ISO (`2026-09-08`) and US (`07/31/2026`) in the same account —
 * so both must land on the same string or every poll looks like a change.
 */
export function normalizeEndDate(raw: string | null): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

/** The normalized identity of an offer — what gets hashed. */
export function offerIdentity(inc: MarketCheckIncentive): OfferIdentity {
  return {
    type: inc.type,
    payment: money(inc.payment),
    term: Math.round(inc.term) || 0,
    downPayment: money(inc.downPayment),
    rate: rate(inc.rate),
    amount: money(inc.amount),
    msrp: money(inc.msrp),
    trim: (inc.trim ?? '').trim().toLowerCase(),
    endDate: normalizeEndDate(inc.endDate),
  };
}

/**
 * Stable 16-hex-char fingerprint for an offer. Two offers with the same numbers,
 * trim and end date fingerprint identically even if the feed reworded them.
 */
export function offerFingerprint(inc: MarketCheckIncentive): string {
  const id = offerIdentity(inc);
  const canonical = [
    id.type,
    id.payment,
    id.term,
    id.downPayment,
    id.rate,
    id.amount,
    id.msrp,
    id.trim,
    id.endDate,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * The scope a fingerprint is unique WITHIN — the search that produced it. The
 * same programme surfaced for two models is two separate watch rows, because a
 * dealer advertises them separately.
 */
export function offerScopeKey(params: {
  accountKey: string;
  make: string;
  model: string;
  year: number;
  zip?: string;
}): string {
  return [
    params.accountKey,
    params.make.trim().toLowerCase(),
    params.model.trim().toLowerCase(),
    params.year,
    (params.zip ?? '').trim(),
  ].join('|');
}

/**
 * The offer key stored on an `AdCreative`, which must be unique PER VEHICLE.
 *
 * `offerFingerprint` deliberately identifies the OFFER and excludes the vehicle —
 * that's correct for offer diffing, and `OemOfferSnapshot` pairs it with
 * `scopeKey` to disambiguate. `AdCreative`'s unique index has no scope column,
 * though, so the bare fingerprint is the wrong value to store there.
 *
 * Observed for real: GM ran one identical "4.9% APR for 60 months" programme
 * across the Silverado 2500HD and 3500HD. Same numbers, same term, same end date
 * ⇒ same fingerprint ⇒ the second vehicle's draft silently OVERWROTE the first's.
 * They are one programme but two ads, so the key has to carry the vehicle.
 *
 * Kept human-readable rather than hashed: this value shows up in debugging and in
 * the review queue, and "2026-chevrolet-silverado-2500hd:9f2a…" is far easier to
 * reason about than an opaque digest.
 */
export function creativeOfferKey(
  vehicle: { year: number; make: string; model: string },
  fingerprint: string,
): string {
  const slug = `${vehicle.year}-${vehicle.make}-${vehicle.model}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug}:${fingerprint}`;
}

export type OfferChangeKind = 'new' | 'unchanged' | 'ended';

export interface OfferDiffEntry {
  fingerprint: string;
  kind: OfferChangeKind;
  incentive?: MarketCheckIncentive;
}

export interface OfferDiff {
  entries: OfferDiffEntry[];
  new: OfferDiffEntry[];
  unchanged: OfferDiffEntry[];
  ended: OfferDiffEntry[];
}

/**
 * Diff this poll's offers against the fingerprints last seen for the same scope.
 *
 * Note there is no 'changed' kind by design: an offer whose numbers move gets a
 * different fingerprint, so it surfaces as one `ended` plus one `new`. That's
 * the honest representation — the old programme really did stop being offered —
 * and it keeps the comparison a pure set operation.
 */
export function diffOffers(
  current: MarketCheckIncentive[],
  previousFingerprints: string[],
): OfferDiff {
  const prev = new Set(previousFingerprints);
  const seen = new Set<string>();
  const entries: OfferDiffEntry[] = [];

  for (const inc of current) {
    const fingerprint = offerFingerprint(inc);
    // The same programme can appear twice in one pull (trim variants collapse to
    // the same numbers); count it once.
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    entries.push({ fingerprint, kind: prev.has(fingerprint) ? 'unchanged' : 'new', incentive: inc });
  }

  for (const fingerprint of prev) {
    if (!seen.has(fingerprint)) entries.push({ fingerprint, kind: 'ended' });
  }

  return {
    entries,
    new: entries.filter((e) => e.kind === 'new'),
    unchanged: entries.filter((e) => e.kind === 'unchanged'),
    ended: entries.filter((e) => e.kind === 'ended'),
  };
}
