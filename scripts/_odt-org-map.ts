/**
 * Shared ODT-org → Loomi-account resolution for the ODT migration scripts
 * (import-odt-backlog, import-odt-evox). One source of truth for the rename
 * overrides + the name-normalization match, so the two importers can't drift.
 */

/**
 * ODT org name → Loomi account key, for orgs whose ODT name doesn't normalize
 * to any Account.dealer (ODT drops "of", pluralizes "Trailers", reorders CJDR
 * makes, etc.). Confirmed 1:1 by name + zip against the Loomi prod account list
 * (2026-07-01). `null` = intentionally skipped.
 */
export const ORG_OVERRIDES: Record<string, string | null> = {
  // Internal test data — never import.
  'Oz Marketing': null,
  // Renamed on Loomi (ODT name → Loomi key). Verified by name + zip.
  'Young Ford Ogden': 'youngFordOfOgden',
  'Young Ford Morgan': 'youngFordOfMorgan',
  'Young Ford of Brigham City': 'youngFordOfBrigham',
  'Young Chrysler Jeep Dodge Ram Fiat Idaho': 'youngChryslerDodgeJeepRamOfBurley', // Burley, ID (83318)
  'Young Chrysler Jeep Dodge Ram Layton': 'youngChryslerDodgeJeepRamOfLayton',
  'Young Chrysler Jeep Dodge Ram Morgan': 'youngChryslerDodgeJeepRamOfMorgan',
  'Genesis of Ogden': 'genesisOgden',
  'Young Mazda Missoula': 'youngMazdaOfMissoula',
  'Young Mazda Ogden': 'youngMazdaOfOgden',
  'Young Powersports Burley': 'youngPowersportsOfBurley',
  'Young Powersports Layton': 'youngPowersportsLayton',
  'Young Powersports Logan': 'youngPowersportsOfLogan',
  'Young Powersports Missoula': 'youngPowersportsOfMissoula',
  'Young Powersports Morgan': 'youngPowersportsOfMorgan',
  'Young Powersports Ogden': 'youngPowersportsOfOgden',
  'Young Truck and Trailers Kaysville': 'youngTruckAndTrailerOfKaysville',
  'Young Truck and Trailers Logan': 'youngTruckAndTrailerOfLogan',
  'Young Commercial': 'youngCommercialFleet',
  // Genuinely not in Loomi yet (no account) — left unmatched on purpose:
  //   Young Powersports Centerville, Xtreme Accessories, Young Nissan Riverdale
};

export const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Build orgId → Loomi account key (or null when unmatched/skipped). An override
 * that points at a nonexistent account key warns and resolves to null, so a
 * typo can't FK-fail an import mid-run.
 */
export function resolveOrgAccounts(
  orgs: { id: number; name: string }[],
  accounts: { key: string; dealer: string }[],
): Map<number, string | null> {
  const byNorm = new Map(accounts.map((a) => [norm(a.dealer), a.key]));
  const validKeys = new Set(accounts.map((a) => a.key));
  const mapping = new Map<number, string | null>();
  for (const org of orgs) {
    let key: string | null;
    if (org.name in ORG_OVERRIDES) key = ORG_OVERRIDES[org.name];
    else key = byNorm.get(norm(org.name)) ?? null;
    if (key && !validKeys.has(key)) {
      console.warn(`  ! override for "${org.name}" → "${key}" has no matching account — skipping`);
      key = null;
    }
    mapping.set(org.id, key);
  }
  return mapping;
}
