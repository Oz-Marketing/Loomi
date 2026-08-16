/**
 * Client-safe GA4 constants.
 *
 * Import from here in client components — never from `@/lib/integrations/ga4`,
 * which pulls in `node:crypto` for the service-account JWT exchange and has no
 * business in a browser bundle. Same split, and the same reason, as
 * `lib/roles.ts` vs `lib/auth.ts`.
 */

/**
 * VDP (vehicle-detail-page) URL regex per dealer website platform — GA4
 * PARTIAL_REGEXP (RE2). Each matches individual vehicle pages while excluding
 * search/listing (SRP/VLP) pages. Ported verbatim from ODT.
 *
 * Adding a platform here is all that is needed: the Integrations card derives
 * its dropdown from these keys, and `resolveGa4Platform` will only accept a
 * stored value that appears in this table.
 */
export const VDP_PLATFORM_PATTERNS: Record<string, string> = {
  dealer_com: '/(new|used|certified)/[^/]+/[0-9]{4}-',
  dealer_spike:
    '(xInventoryDetail|xPreOwnedInventoryDetail|--[0-9]{4}-[A-Za-z].*[0-9]{3,}|/[A-Za-z]+/[0-9]{4}-[A-Za-z].*[0-9]{4,})',
  dealer_eprocess: '/auto/(new|used|certified)-[0-9]{4}-',
  room58: '(/vehicles/[0-9]{4}-[A-Za-z]|/vehicle-detail/[0-9])',
  team_velocity: '/viewdetails/(new|used|certified)/[a-zA-Z0-9]+/[0-9]{4}-',
};

/** The platform assumed when an account has none set — the most common DDC. */
export const DEFAULT_VDP_PLATFORM = 'dealer_com';
