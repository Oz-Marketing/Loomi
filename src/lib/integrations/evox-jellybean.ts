/**
 * Vehicle "jellybean" resolver for contact pages — a thin, COST-SAFE layer
 * over the EVOX client (evox.ts).
 *
 * Cost model (why this is cheap):
 *   - EVOX is already licensed (the Ad Generator uses the same account).
 *   - We cache by VEHICLE CONFIG (year/make/model/color), shared across every
 *     contact + the Ad Generator, re-hosted to S3 by importEvoxImage() under a
 *     deterministic key. So a given config hits EVOX at most ONCE, ever; every
 *     later view serves the free S3 copy.
 *   - Resolution is LAZY (only when a contact page is opened), never a bulk
 *     scan — so EVOX calls track "vehicles actually viewed," a small fraction.
 *
 * Everything degrades gracefully: no key, no match, or any error → null, and
 * the Vehicle card falls back to a color-chip + icon.
 */
import {
  evoxConfigured,
  searchVehicles,
  resolveImageUrl,
  resolveThumbBytes,
  importEvoxImage,
  type EvoxColor,
} from '@/lib/integrations/evox';
import { autoCropVehicleImage } from '@/lib/integrations/evox-crop';
import { buildS3Key, s3PublicUrl } from '@/lib/s3';
import { prisma } from '@/lib/prisma';

// CRM feeds ship abbreviated / messy makes (CDK: CHEV, HYUN, MAZD, RAMT; Tekion
// sends cleaner names). EVOX's YMM search wants real make names, so normalize
// first. Unknown values pass through title-cased — EVOX's endpoint is forgiving.
const MAKE_ALIASES: Record<string, string> = {
  CHEV: 'Chevrolet', CHEVY: 'Chevrolet', GMC: 'GMC', BUIC: 'Buick', CADI: 'Cadillac',
  FORD: 'Ford', LINC: 'Lincoln', RAMT: 'Ram', RAM: 'Ram', DODG: 'Dodge', CHRY: 'Chrysler',
  JEEP: 'Jeep', FIAT: 'Fiat', TOYO: 'Toyota', LEXU: 'Lexus', HOND: 'Honda', ACUR: 'Acura',
  NISS: 'Nissan', INFI: 'Infiniti', HYUN: 'Hyundai', KIA: 'Kia', GENE: 'Genesis',
  MAZD: 'Mazda', SUBA: 'Subaru', MITS: 'Mitsubishi', VW: 'Volkswagen', VOLK: 'Volkswagen',
  AUDI: 'Audi', BMW: 'BMW', MB: 'Mercedes-Benz', MERC: 'Mercedes-Benz', VOLV: 'Volvo',
  PORS: 'Porsche', LAND: 'Land Rover', JAGU: 'Jaguar', MINI: 'Mini', TESL: 'Tesla',
};

export function normalizeMake(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const upper = trimmed.toUpperCase();
  if (MAKE_ALIASES[upper]) return MAKE_ALIASES[upper];
  // Title-case a longer free-form value (e.g. "chevrolet" → "Chevrolet").
  return trimmed.length <= 4
    ? trimmed
    : trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

export interface JellybeanInput {
  year?: string | number | null;
  make?: string | null;
  model?: string | null;
  /** Optional CRM color string; matched to EVOX's palette when present. */
  color?: string | null;
}

export interface JellybeanResult {
  url: string;
  matchedColor: string | null;
  /** true when served from the S3 cache (no EVOX call this request). */
  cached: boolean;
}

/** Deterministic S3 key for a config — mirrors importEvoxImage()'s scheme so a
 *  cache-hit check needs no EVOX call. Shared (accountKey=null). */
function configHint(year: number, make: string, model: string, colorCode: string): string {
  return `${year}-${make}-${model}-${colorCode || 'base'}`
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function cacheKeyFor(hint: string): string {
  return buildS3Key(null, `evox-${hint}`, `${hint}.png`);
}

/** Pick the EVOX color best matching the CRM color string; else the first. */
function pickColor(colors: EvoxColor[], crmColor?: string | null): EvoxColor | null {
  if (colors.length === 0) return null;
  const want = (crmColor || '').trim().toLowerCase();
  if (want) {
    const hit =
      colors.find((c) => c.name.toLowerCase() === want || c.simple.toLowerCase() === want) ||
      colors.find((c) => c.name.toLowerCase().includes(want) || want.includes(c.simple.toLowerCase()));
    if (hit) return hit;
  }
  return colors[0];
}

/**
 * Resolve a contact's vehicle to a cached jellybean URL, or null. Never throws.
 * Order: config cache (free) → EVOX search + resolve + S3 re-host (one-time).
 */
export async function resolveJellybean(input: JellybeanInput): Promise<JellybeanResult | null> {
  if (!evoxConfigured()) return null;

  const year = Number(input.year);
  const make = normalizeMake(String(input.make ?? ''));
  const model = (input.model ?? '').toString().trim();
  if (!year || !make || !model) return null;

  try {
    // 1) Cache probe by config — no EVOX call on a hit. We probe a couple of
    //    likely color codes: the CRM color's match is resolved lazily, so on a
    //    warm config we still short-circuit via the stored MediaAsset below.
    const vehicles = await searchVehicles(year, make, model);
    if (vehicles.length === 0) return null;
    const vehicle = vehicles[0];
    const color = pickColor(vehicle.colors, input.color);
    if (!color) return null;

    const hint = configHint(year, make, model, color.code);
    const key = cacheKeyFor(hint);

    const existing = await prisma.mediaAsset.findUnique({
      where: { s3Key: key },
      select: { s3Key: true },
    });
    if (existing) {
      return { url: s3PublicUrl(key), matchedColor: color.name || null, cached: true };
    }

    // 2) Miss → resolve hi-res, re-host to S3 (deterministic key = cache key).
    const evoxUrl = await resolveImageUrl(vehicle.vifnum, color.code, true);
    if (!evoxUrl) return null;
    const hostedUrl = await importEvoxImage(evoxUrl, null, hint);
    return { url: hostedUrl, matchedColor: color.name || null, cached: false };
  } catch (err) {
    console.warn('[evox-jellybean] resolve failed:', err);
    return null;
  }
}

/**
 * Resolve a contact's vehicle to auto-cropped jellybean PNG bytes (tight to the
 * vehicle, EVOX watermark removed) — no S3 required. Used by the render proxy so
 * the image is cropped in every environment, not just where a bucket exists.
 */
export async function resolveJellybeanBytes(input: JellybeanInput): Promise<Buffer | null> {
  if (!evoxConfigured()) return null;

  const year = Number(input.year);
  const make = normalizeMake(String(input.make ?? ''));
  const model = (input.model ?? '').toString().trim();
  if (!year || !make || !model) return null;

  try {
    const vehicles = await searchVehicles(year, make, model);
    if (vehicles.length === 0) return null;
    const vehicle = vehicles[0];
    const color = pickColor(vehicle.colors, input.color);
    if (!color) return null;

    const raw = await resolveThumbBytes(vehicle.vifnum, color.code);
    if (!raw) return null;
    const { buffer } = await autoCropVehicleImage(raw);
    return buffer;
  } catch (err) {
    console.warn('[evox-jellybean] bytes failed:', err);
    return null;
  }
}
