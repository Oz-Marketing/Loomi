/**
 * Which external property/listing a sub-account reports on — read from the
 * `Account` row, falling back to the legacy env maps.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
 * GA4 properties and Google Places listings used to be mapped ONLY in env
 * (`GA4_PROPERTY_MAP`, `GA4_PLATFORM_MAP`, `GOOGLE_PLACES_MAP`). Two costs:
 * onboarding a rooftop meant editing an env var and redeploying, and a report
 * that came back "not mapped" had no page in the app to send an agency user to
 * — the fix lived in a deploy pipeline. Both now live on `Account`.
 *
 * ── THE FALLBACK IS A CUTOVER AID, NOT A DESIGN ─────────────────────────────
 * Each resolver prefers the column and falls back to env, so an environment
 * that has not run `scripts/backfill-account-mappings.ts` keeps reporting
 * exactly as before. Once the backfill has run everywhere, delete the env
 * branches AND the env vars — leaving them means two places to look when a
 * report shows the wrong property, and the column silently winning.
 *
 * ── WHY THE PURE PARSERS STAYED WHERE THEY WERE ─────────────────────────────
 * The env parsing lives in ga4.ts / google-places.ts as `*FromEnv`, and this is
 * the only module that touches prisma. That keeps those two unit-testable
 * without a database, and keeps the "which account" question in one file rather
 * than smeared across every integration.
 */
import { prisma } from '@/lib/prisma';
import {
  VDP_PLATFORM_PATTERNS,
  resolveGa4PropertyFromEnv,
  resolveGa4PlatformFromEnv,
} from './ga4';
import {
  resolvePlaceConfigFromEnv,
  resolveAccountByPlaceIdFromEnv,
  type PlaceConfig,
  type PlaceAccountLookup,
} from './google-places';

/** GA4 property ids are numeric; the UI accepts pasted junk, so normalize. */
function digitsOnly(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = String(v).replace(/[^0-9]/g, '');
  return d || null;
}

function trimmed(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * GA4 numeric property id for an account, or null when it has none.
 * Column first, env map second.
 */
export async function resolveGa4Property(accountKey: string): Promise<string | null> {
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { ga4PropertyId: true },
  });
  return digitsOnly(account?.ga4PropertyId) ?? resolveGa4PropertyFromEnv(accountKey);
}

/**
 * Website-platform key selecting the VDP url pattern. Always returns a usable
 * platform — `dealer_com` is the most common and the documented default, so an
 * unmapped account still gets VDP numbers rather than an error.
 *
 * An unrecognized stored value falls through to the env map rather than being
 * trusted: the column is free text, and a typo that silently matched nothing
 * would zero out VDP views with no visible cause.
 */
export async function resolveGa4Platform(accountKey: string): Promise<string> {
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { ga4Platform: true },
  });
  const stored = trimmed(account?.ga4Platform);
  if (stored && VDP_PLATFORM_PATTERNS[stored]) return stored;
  return resolveGa4PlatformFromEnv(accountKey);
}

/**
 * Google Places listing (+ optional competitor) for an account.
 *
 * A competitor without a primary is not a config — there is nothing to report
 * on — so the column branch requires `googlePlaceId` before it wins. Otherwise
 * a half-filled row would shadow a complete env entry.
 */
export async function resolvePlaceConfig(accountKey: string): Promise<PlaceConfig | null> {
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { googlePlaceId: true, googleCompetitorPlaceId: true },
  });
  const placeId = trimmed(account?.googlePlaceId);
  if (placeId) {
    return {
      placeId,
      competitorPlaceId: trimmed(account?.googleCompetitorPlaceId) ?? undefined,
    };
  }
  return resolvePlaceConfigFromEnv(accountKey);
}

/**
 * The inverse: which account owns a Google listing. The review ingest knows a
 * place id and needs the account.
 *
 * Ambiguity is REPORTED, never resolved — two accounts on one listing is a
 * config error, and picking one would attribute a rooftop's reviews to its
 * neighbour with nothing on screen to show for it. The DB and env sources are
 * unioned before that check, so a listing that is on an Account row AND still
 * in the env map does not read as a conflict with itself.
 *
 * Only primary listings match. A competitor is one we watch, not one we own.
 */
export async function resolveAccountByPlaceId(placeId: string): Promise<PlaceAccountLookup> {
  const wanted = placeId.trim();
  if (!wanted) return { status: 'unmapped' };

  const rows = await prisma.account.findMany({
    where: { googlePlaceId: wanted },
    select: { key: true },
  });

  const keys = new Set(rows.map((r) => r.key));
  const fromEnv = resolveAccountByPlaceIdFromEnv(wanted);
  if (fromEnv.status === 'ok') keys.add(fromEnv.accountKey);
  else if (fromEnv.status === 'ambiguous') fromEnv.accountKeys.forEach((k) => keys.add(k));

  const matches = [...keys].sort();
  if (matches.length === 0) return { status: 'unmapped' };
  if (matches.length > 1) return { status: 'ambiguous', accountKeys: matches };
  return { status: 'ok', accountKey: matches[0] };
}
