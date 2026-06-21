/**
 * EVOX Images integration — vehicle photography for the Ad Generator.
 *
 * Ported from Oz Dealer Tools' EvoxApi. This account is licensed for Product 27
 * (front ¾ only): PTID 213 = transparent PNG 640×480, 216 = 2400×1800. The Base
 * Trim Library product (48 / 432 / 435) is a fallback for base trims. All four
 * are overridable via env for forward-compat if the account is upgraded.
 *
 * Auth: the key (EVOX_API_KEY) is sent BOTH as an `x-api-key` header and a
 * `?api_key=` query param — EVOX expects both. Server-only (reads the key +
 * touches S3); never import into a client component.
 *
 * Unlike ODT we do NOT sync the whole EVOX catalog into local tables; we call
 * the forgiving GET YMM endpoint directly (with a curated make list in the UI).
 */
import { uploadToS3, buildS3Key, s3PublicUrl, isS3Configured } from '@/lib/s3';

const BASE = 'https://api.evoximages.com/api/v1';
const PID = Number(process.env.EVOX_PRODUCT_ID ?? 27);
const PTID_640 = Number(process.env.EVOX_PTID_640 ?? 213); // transparent PNG 640×480, front ¾
const PTID_2400 = Number(process.env.EVOX_PTID_2400 ?? 216); // transparent PNG 2400×1800, front ¾
const BTL_PID = 48;
const BTL_PTID_640 = 432;
const BTL_PTID_2400 = 435;
const TIMEOUT_MS = 15000;

function apiKey(): string {
  return process.env.EVOX_API_KEY ?? '';
}

export function evoxConfigured(): boolean {
  return apiKey().length > 0;
}

export interface EvoxColor {
  code: string;
  name: string;
  simple: string;
  rgb: string;
  /** 640px transparent-PNG URL from the search call (good for thumbnails). */
  thumbUrl: string;
}

export interface EvoxVehicle {
  vifnum: number;
  year: number;
  make: string;
  model: string;
  trim: string;
  colors: EvoxColor[];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function evoxGet(path: string): Promise<any | null> {
  const k = apiKey();
  if (!k) return null;
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(k)}`;
  try {
    const res = await fetch(url, { headers: { 'x-api-key': k }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`[evox] GET ${path.split('?')[0]} → HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[evox] GET failed:', err);
    return null;
  }
}

/** Pull the first usable image URL out of EVOX's several response shapes. */
function extractUrl(resp: any, ptid: number): string {
  if (!resp) return '';
  const pt = resp.product_types?.[ptid] ?? resp.product_types?.[String(ptid)] ?? null;
  if (Array.isArray(pt)) {
    for (const e of pt) {
      const u = str(e.url || e.image_url);
      if (u) return u;
    }
  }
  if (Array.isArray(resp.data)) {
    for (const e of resp.data) {
      const u = str(e.url || e.image_url);
      if (u) return u;
    }
  }
  if (Array.isArray(resp.urls)) {
    for (const e of resp.urls) {
      const u = typeof e === 'string' ? e : str(e?.url);
      if (u) return u;
    }
  }
  return str(resp.url || resp.image_url);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Search Year/Make/Model (+ optional trim) → the matching trims, each with its
 * available colors and a 640px transparent-PNG thumbnail. One GET call.
 */
export async function searchVehicles(year: number, make: string, model: string, trim?: string): Promise<EvoxVehicle[]> {
  const params = new URLSearchParams({ year: String(year), make, model, pid: String(PID), ptid: String(PTID_640) });
  if (trim) params.set('trim', trim);
  const resp = await evoxGet(`/vehicles?${params.toString()}`);
  const records: Record<string, unknown>[] = resp?.data ?? (Array.isArray(resp) ? resp : []);
  if (!records.length) return [];

  // Records come one-per-color; group them into trims by vifnum.
  const byVif = new Map<number, EvoxVehicle>();
  for (const rec of records) {
    const vifnum = Number(rec.vifnum ?? rec.vif_num ?? rec.sendnum ?? 0);
    if (!vifnum) continue;
    if (!byVif.has(vifnum)) {
      byVif.set(vifnum, {
        vifnum,
        year: Number(rec.year ?? year),
        make: str(rec.make) || make,
        model: str(rec.model) || model,
        trim: str(rec.trim) || 'Base',
        colors: [],
      });
    }
    const code = str(rec.color_code);
    if (!code) continue;
    const v = byVif.get(vifnum)!;
    if (v.colors.some((c) => c.code === code)) continue;
    v.colors.push({
      code,
      name: str(rec.color_title || rec.color_name),
      simple: str(rec.color_simpletitle || rec.color_simple),
      rgb: str(rec.rgb1 || rec.rgb),
      thumbUrl: str(rec.image_url || rec.url),
    });
  }
  return [...byVif.values()].filter((v) => v.colors.length > 0);
}

/**
 * Resolve a vehicle+color to an image URL (hi-res 2400px by default). Tries the
 * standard product first, then the Base Trim Library.
 */
export async function resolveImageUrl(vifnum: number, colorCode: string, hires = true): Promise<string | null> {
  const tries: [number, number][] = hires
    ? [[PID, PTID_2400], [BTL_PID, BTL_PTID_2400]]
    : [[PID, PTID_640], [BTL_PID, BTL_PTID_640]];
  for (const [pid, ptid] of tries) {
    const resp = await evoxGet(`/vehicles/${vifnum}/products/${pid}/${ptid}?color_code=${encodeURIComponent(colorCode)}`);
    const url = extractUrl(resp, ptid);
    if (url) return url;
  }
  return null;
}

/**
 * Download an EVOX image and re-host it on our S3 so saved ads never break when
 * the (pre-signed) EVOX CDN URL expires. Returns our stable URL, or the EVOX
 * URL unchanged if S3 isn't configured. CDN URLs are pre-signed — only
 * api.evoximages.com URLs get the key.
 */
export async function importEvoxImage(url: string, accountKey: string | null, hint: string): Promise<string> {
  let fetchUrl = url;
  const headers: Record<string, string> = {};
  try {
    const host = new URL(url).host;
    if (host.includes('api.evoximages.com')) {
      headers['x-api-key'] = apiKey();
      if (!url.includes('api_key=')) fetchUrl += `${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(apiKey())}`;
    }
  } catch {
    throw new Error('Invalid image URL');
  }

  const res = await fetch(fetchUrl, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`EVOX image fetch HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 1).toString('latin1');
  if (head === '{' || head === '<') throw new Error('EVOX returned non-image data');

  if (!isS3Configured()) return url; // no bucket → fall back to the EVOX URL
  const safeHint = hint.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'vehicle';
  const key = buildS3Key(accountKey, `evox-${Date.now()}`, `${safeHint}.png`);
  await uploadToS3(key, buf, 'image/png');
  return s3PublicUrl(key);
}
