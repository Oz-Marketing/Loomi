/**
 * Copy the GA4 + Google Places account mappings out of env and onto `Account`.
 *
 * `GA4_PROPERTY_MAP`, `GA4_PLATFORM_MAP` and `GOOGLE_PLACES_MAP` were the only
 * home for these, which made onboarding a rooftop a redeploy and left the
 * Website and Reputation reports with no in-app page to point an agency user at
 * when they came back unmapped. The columns are the home now; the resolvers in
 * lib/integrations/account-mapping.ts still read env as a fallback so this
 * script is a migration rather than a flag day.
 *
 * IDEMPOTENT, AND THE COLUMN ALWAYS WINS. A row that already has a value is
 * left alone — someone editing a property id in the Integrations UI must not
 * have it stamped back to the env value on the next deploy. That also makes
 * re-running free, which is what lets it sit in the deploy chain.
 *
 * Unknown account keys in the maps are reported, not created: an env map that
 * has drifted from the account list is worth seeing in the deploy log.
 *
 *   npx tsx scripts/backfill-account-mappings.ts
 */
import { prisma } from '@/lib/prisma';
import { VDP_PLATFORM_PATTERNS } from '@/lib/integrations/ga4';

/** Parse one env var as a JSON object, or null if absent/!JSON. */
function parseMap<T>(name: string): Record<string, T> | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(`[backfill-account-mappings] ${name} is not a JSON object — skipping.`);
      return null;
    }
    return parsed as Record<string, T>;
  } catch {
    console.warn(`[backfill-account-mappings] ${name} is not valid JSON — skipping.`);
    return null;
  }
}

type PlaceEntry = string | { placeId?: string; competitorPlaceId?: string };

async function main() {
  const properties = parseMap<string | number>('GA4_PROPERTY_MAP');
  const platforms = parseMap<string>('GA4_PLATFORM_MAP');
  const places = parseMap<PlaceEntry>('GOOGLE_PLACES_MAP');

  if (!properties && !platforms && !places) {
    console.log('[backfill-account-mappings] No legacy maps in env — nothing to do.');
    return;
  }

  // One read of every key the maps mention, rather than a findUnique per key.
  const keys = [
    ...new Set([
      ...Object.keys(properties ?? {}),
      ...Object.keys(platforms ?? {}),
      ...Object.keys(places ?? {}),
    ]),
  ];
  const existing = await prisma.account.findMany({
    where: { key: { in: keys } },
    select: {
      key: true,
      ga4PropertyId: true,
      ga4Platform: true,
      googlePlaceId: true,
      googleCompetitorPlaceId: true,
    },
  });
  const byKey = new Map(existing.map((a) => [a.key, a]));

  const unknown = keys.filter((k) => !byKey.has(k));
  if (unknown.length) {
    console.warn(
      `[backfill-account-mappings] ${unknown.length} key(s) in env have no account: ${unknown.join(', ')}`,
    );
  }

  let updated = 0;
  let skipped = 0;

  for (const key of keys) {
    const account = byKey.get(key);
    if (!account) continue;

    const patch: Record<string, string> = {};

    // GA4 property — digits only, matching what the resolver accepts.
    if (!account.ga4PropertyId) {
      const digits = String(properties?.[key] ?? '').replace(/[^0-9]/g, '');
      if (digits) patch.ga4PropertyId = digits;
    }

    // Platform — only a key we have a VDP pattern for. An unrecognized value
    // would read as "configured" while matching no vehicle pages at all.
    if (!account.ga4Platform) {
      const platform = platforms?.[key]?.trim();
      if (platform && VDP_PLATFORM_PATTERNS[platform]) patch.ga4Platform = platform;
    }

    // Places — the env value is either a bare id or an object.
    if (!account.googlePlaceId) {
      const entry = places?.[key];
      const placeId = (typeof entry === 'string' ? entry : entry?.placeId)?.trim();
      if (placeId) {
        patch.googlePlaceId = placeId;
        const competitor =
          typeof entry === 'object' ? entry?.competitorPlaceId?.trim() : undefined;
        // Only alongside a primary: a competitor on its own is not a config.
        if (competitor && !account.googleCompetitorPlaceId) {
          patch.googleCompetitorPlaceId = competitor;
        }
      }
    }

    if (Object.keys(patch).length === 0) {
      skipped += 1;
      continue;
    }
    await prisma.account.update({ where: { key }, data: patch });
    updated += 1;
    console.log(`[backfill-account-mappings] ${key}: ${Object.keys(patch).join(', ')}`);
  }

  console.log(
    `[backfill-account-mappings] Done — ${updated} updated, ${skipped} already set or empty.`,
  );
}

main()
  .catch((err) => {
    console.error('[backfill-account-mappings] failed', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
