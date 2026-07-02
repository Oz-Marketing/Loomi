/**
 * MarketCheck incentives integration — OEM lease / APR / cash programs for the
 * Ad Generator. Ported (trimmed) from Oz Dealer Tools' MarketCheckIncentives.
 *
 * Endpoint: GET {base}/search/car/incentive/oem?api_key&make&model&year&zip&radius
 * Auth: MARKETCHECK_API_KEY (query param). Server-only.
 *
 * The generator shows the returned feed; a designer applies one to auto-fill the
 * structured offer fields. Manual offer entry still works — this is one source.
 */

const BASE = process.env.MARKETCHECK_BASE_URL ?? 'https://mc-api.marketcheck.com/v2';
const PAGE_SIZE = 10; // MarketCheck caps incentive results at 10/page regardless of `rows`
const MAX_PAGES = 8;
const REQUEST_TIMEOUT_MS = 10000;
const DEADLINE_MS = 20000; // total budget across pages + fallbacks; the API route allows 30s
const CACHE_TTL_HIT_MS = 24 * 60 * 60 * 1000; // OEM programs are stable day-to-day
const CACHE_TTL_MISS_MS = 60 * 60 * 1000; // retry empty results sooner
const CACHE_MAX = 200;

function apiKey(): string {
  return process.env.MARKETCHECK_API_KEY ?? '';
}

export function marketcheckConfigured(): boolean {
  return apiKey().length > 0;
}

export type IncentiveType = 'cash' | 'lease' | 'apr' | 'other';

export interface MarketCheckIncentive {
  id: string | null;
  type: IncentiveType;
  amount: number; // cash / rebate
  rate: number; // APR %
  term: number; // months
  payment: number; // monthly lease payment
  downPayment: number; // due at signing
  msrp: number;
  trim: string | null;
  programName: string | null;
  description: string;
  offerDetails: string;
  startDate: string | null;
  endDate: string | null;
  eligibility: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^0-9.]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function extractFloat(obj: Record<string, any>, keys: string[]): number {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
      const n = num(obj[k]);
      if (n) return n;
    }
  }
  return 0;
}

function extractString(obj: Record<string, any>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v) && v.length) return v.filter(Boolean).join(' ').trim();
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** Pull the incentives array out of MarketCheck's several response shapes. */
function extractItems(resp: any): Record<string, any>[] {
  if (Array.isArray(resp)) return resp;
  for (const key of ['listings', 'incentives', 'results', 'data', 'offers', 'items']) {
    if (Array.isArray(resp?.[key])) return resp[key];
  }
  return [];
}

function transform(item: Record<string, any>): MarketCheckIncentive | null {
  const offer = (item.offer && typeof item.offer === 'object' ? item.offer : {}) as Record<string, any>;
  const flat: Record<string, any> = { ...item, ...offer };
  if (Array.isArray(flat.amounts) && flat.amounts[0] && typeof flat.amounts[0] === 'object') {
    Object.assign(flat, flat.amounts[0]);
  }

  // ── type ──
  const raw = String(flat.offer_type ?? flat.type ?? flat.incentive_type ?? flat.category ?? flat.program_type ?? '').toLowerCase();
  let type: IncentiveType = 'other';
  if (/cash|rebate|bonus/.test(raw)) type = 'cash';
  else if (/lease/.test(raw)) type = 'lease';
  else if (/finance|apr|rate/.test(raw)) type = 'apr';
  if (type === 'other') {
    const all = JSON.stringify(flat).toLowerCase();
    if (/cash ?back|customer cash|rebate|bonus cash/.test(all)) type = 'cash';
    else if (/% apr|financing|finance/.test(all)) type = 'apr';
    else if (/lease/.test(all)) type = 'lease';
  }

  // ── numbers ──
  let amount = extractFloat(flat, ['cashback_amount', 'amount', 'cash_amount', 'rebate_amount', 'value', 'bonus_amount', 'incentive_amount']);
  let rate = extractFloat(flat, ['apr', 'rate', 'interest_rate', 'finance_rate']);
  let term = Math.round(extractFloat(flat, ['term', 'months', 'term_months', 'duration', 'lease_term']));
  let payment = extractFloat(flat, ['monthly_payment', 'payment', 'lease_payment', 'mo_payment', 'monthly_amount', 'monthly']);
  const downPayment = extractFloat(flat, ['due_at_signing', 'cash_due_at_signing', 'das', 'down_payment']);
  const msrp = extractFloat(flat, ['msrp', 'sticker_price', 'retail_price']);
  const totalMonthly = extractFloat(flat, ['total_monthly_payments']);
  if (payment <= 0 && totalMonthly > 0 && term > 0) payment = Math.round(totalMonthly / term);

  // ── human-readable offer string (offers[]/titles/disclaimers) ──
  const offersArr = Array.isArray(flat.offers) ? flat.offers : flat.offers ? [String(flat.offers)] : [];
  const offersLine = String(offersArr[0] ?? '').trim();
  if (payment <= 0 || term <= 0 || rate <= 0) {
    const text = [
      ...(offersArr as any[]),
      ...(Array.isArray(flat.titles) ? flat.titles : []),
      ...(Array.isArray(flat.disclaimers) ? flat.disclaimers : []),
    ]
      .map(String)
      .join(' ');
    if (payment <= 0) {
      const m = text.match(/\$\s?([\d,]+(?:\.\d{1,2})?)\s*(?:per\s+month|\/\s*mo(?:nth)?)/i);
      if (m) payment = num(m[1]);
    }
    if (term <= 0) {
      const m = text.match(/(?:for\s+)?(\d{2,3})\s*-?\s*months?/i);
      if (m) term = parseInt(m[1], 10);
    }
    if (rate <= 0) {
      const m = text.match(/([\d.]+)\s*%\s*(?:APR|financing)/i);
      if (m) rate = num(m[1]);
    }
  }

  // ── program name (avoid generic/vehicle labels) ──
  const titlesFirst = Array.isArray(flat.titles) ? String(flat.titles[0] ?? '').trim() : '';
  let programName: string | null = flat.oem_program_name ?? flat.program_name ?? (titlesFirst || null) ?? null;
  const pn = String(programName ?? '');
  if (
    ['cash', 'lease', 'apr', 'finance', 'financing', 'rebate', 'other', ''].includes(pn.toLowerCase()) ||
    /^20\d\d\s+\w/.test(pn) ||
    (pn === pn.toUpperCase() && !pn.includes('$') && pn.length < 60)
  ) {
    programName = null;
  }

  // ── trim ──
  const vehicle = (Array.isArray(item.vehicles) ? item.vehicles[0] : Array.isArray(flat.vehicles) ? flat.vehicles[0] : {}) || {};
  const trim = vehicle.trim ?? vehicle.trim_name ?? vehicle.trim_level ?? flat.trim ?? flat.trim_name ?? null;

  const startDate = flat.valid_from ?? flat.start_date ?? flat.effective_date ?? flat.begin_date ?? null;
  const endDate = flat.valid_through ?? flat.end_date ?? flat.expiration_date ?? flat.expire_date ?? flat.expiry_date ?? null;
  const eligibility = extractString(flat, ['disclaimers', 'eligibility', 'requirements', 'conditions', 'disclaimer', 'fine_print', 'legal', 'terms']);

  // ── description / details ──
  let description = offersLine || extractString(flat, ['title', 'description', 'name', 'offer_name', 'headline', 'summary']);
  if (!description) {
    if (type === 'cash' && amount > 0) description = `$${Math.round(amount).toLocaleString()} ${programName || 'Customer Cash'}`;
    else if (type === 'apr') description = `${rate === 0 ? '0%' : `${rate}%`} APR${term > 0 ? ` for ${term} months` : ''}`;
    else if (type === 'lease' && payment > 0) description = `$${Math.round(payment).toLocaleString()}/mo Lease Special`;
    else description = programName || `${type} incentive`;
  }
  const offerDetails = (Array.isArray(offersArr) ? offersArr.map(String).map((s) => s.trim()).filter(Boolean).join(' ') : '') || description;

  return {
    id: flat.id ?? flat.incentive_id ?? flat.base_sha ?? null,
    type,
    amount,
    rate,
    term,
    payment,
    downPayment,
    msrp,
    trim: trim || null,
    programName,
    description,
    offerDetails,
    startDate: startDate ? String(startDate) : null,
    endDate: endDate ? String(endDate) : null,
    eligibility,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface IncentiveResult {
  incentives: MarketCheckIncentive[];
  /** Model year the results are actually for — may be `year - 1` when the new year has no programs yet. */
  usedYear: number;
  /** True when the zip-scoped search was empty and we broadened to a national search. */
  usedNational: boolean;
}

// 24h in-process cache (pm2 runs one Next process, so this is effective in prod).
// Empty results get a shorter TTL so a dealer isn't stuck an entire day once
// MarketCheck publishes programs. Map iterates in insertion order → cheap FIFO cap.
const cache = new Map<string, { at: number; result: IncentiveResult }>();

function cacheGet(key: string): IncentiveResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  const ttl = hit.result.incentives.length > 0 ? CACHE_TTL_HIT_MS : CACHE_TTL_MISS_MS;
  if (Date.now() - hit.at > ttl) {
    cache.delete(key);
    return null;
  }
  return hit.result;
}

function cacheSet(key: string, result: IncentiveResult) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), result });
}

/**
 * One search pass for an exact (make, model, year, zip) combo, paginated —
 * MarketCheck returns at most 10 incentives per page no matter what `rows`
 * asks for, so a single request silently drops lease/APR programs.
 */
async function searchOnce(key: string, make: string, model: string, year: number, zip: string | undefined, radius: number, deadline: number): Promise<MarketCheckIncentive[]> {
  const out: MarketCheckIncentive[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const remaining = deadline - Date.now();
    if (remaining < 1500) break; // out of budget — return what we have
    const params = new URLSearchParams({ api_key: key, make, rows: String(PAGE_SIZE), start: String(page * PAGE_SIZE) });
    if (model) params.set('model', model);
    if (year) params.set('year', String(year));
    if (zip) {
      params.set('zip', zip);
      params.set('radius', String(radius));
    }
    const res = await fetch(`${BASE}/search/car/incentive/oem?${params.toString()}`, {
      signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
    });
    if (!res.ok) {
      console.warn(`[marketcheck] incentives → HTTP ${res.status}`);
      break;
    }
    const json = await res.json();
    const items = extractItems(json);
    for (const it of items) {
      const t = transform(it);
      if (!t) continue;
      const dedup = t.id || t.offerDetails;
      if (dedup && seen.has(dedup)) continue;
      if (dedup) seen.add(dedup);
      out.push(t);
    }
    if (items.length < PAGE_SIZE) break; // last page
  }
  return out;
}

/**
 * Fetch OEM incentives for a vehicle. Empty list on any failure / not configured.
 *
 * Ported fallbacks from Oz Dealer Tools (its feed behavior, observed in prod):
 *   1. zip-scoped search returns 0 → retry nationally (regional feeds are patchy)
 *   2. the requested model year has no programs yet (common early in a model
 *      year) → retry with year − 1
 * The result says which combination actually produced data so the UI can tell
 * the designer (`usedYear`, `usedNational`).
 */
export async function getIncentives(make: string, model: string, year: number, zip?: string, radius = 75): Promise<IncentiveResult> {
  const empty: IncentiveResult = { incentives: [], usedYear: year, usedNational: false };
  const key = apiKey();
  if (!key || !make) return empty;

  const cacheKey = [make, model, year, zip ?? '', radius].join('|').toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Attempt order: exact → national → last year → last year national.
  const attempts: { year: number; zip?: string }[] = [{ year, zip }];
  if (zip) attempts.push({ year });
  if (year) attempts.push({ year: year - 1, zip });
  if (year && zip) attempts.push({ year: year - 1 });

  const deadline = Date.now() + DEADLINE_MS;
  try {
    for (const attempt of attempts) {
      const incentives = await searchOnce(key, make, model, attempt.year, attempt.zip, radius, deadline);
      if (incentives.length > 0) {
        const result: IncentiveResult = { incentives, usedYear: attempt.year, usedNational: Boolean(zip && !attempt.zip) };
        cacheSet(cacheKey, result);
        return result;
      }
      if (deadline - Date.now() < 1500) break; // no budget left for more fallbacks
    }
    cacheSet(cacheKey, empty);
    return empty;
  } catch (err) {
    console.warn('[marketcheck] incentives failed:', err);
    return empty; // don't cache transport failures
  }
}
