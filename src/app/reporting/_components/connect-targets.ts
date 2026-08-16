/**
 * Where an agency user goes to connect a reporting source.
 *
 * A report section with no data has two very different causes: the account
 * genuinely had no delivery in the window, or nobody ever linked the platform.
 * Only the second is fixable, and only by an agency user — so `EmptyState`
 * renders a connect affordance from this map, gated on MANAGEMENT_ROLES.
 * Clients never see it: to a client "not connected" is not a fact about their
 * month, it is a fact about our setup.
 *
 * Hrefs are BROWSER-facing paths, matching the reporting sidebar — on
 * reporting.loomilm.com the proxy rewrites them, and a hard-coded `/reporting`
 * prefix would produce `reporting.loomilm.com/reporting/...`.
 *
 * GA4 and Google Places used to be absent here: their mapping lived in env
 * (`GA4_PROPERTY_MAP`, `GOOGLE_PLACES_MAP`), so there was no page to send
 * anyone to. Both are `Account` columns now with cards in the same Integrations
 * grid — see docs/reporting-redesign.md §5.
 *
 * The bridge-fed reports (calls, leads, sales, service, heatmap, direct mail)
 * remain deliberately absent: their fix lives in the Oz Reports host's
 * `dealer_map`, not in any Loomi setting, so a link here would go nowhere
 * useful.
 */

/** Reporting sources whose account mapping is editable in Loomi today. */
export type ConnectPlatform =
  | 'google'
  | 'meta'
  | 'stackadapt'
  | 'gohighlevel'
  | 'ga4'
  | 'places';

export interface ConnectTarget {
  href: string;
  label: string;
}

/** Card labels as they read in the Integrations grid, so the link names its target. */
const PLATFORM_LABEL: Record<ConnectPlatform, string> = {
  google: 'Google Ads',
  meta: 'Meta',
  stackadapt: 'StackAdapt',
  gohighlevel: 'GoHighLevel',
  ga4: 'Google Analytics',
  places: 'Google Places',
};

/**
 * The Integrations tab of a sub-account's settings, where
 * `ReportingIntegrationCards` (and the Meta Ads card) already live. Every
 * platform shares one destination — the grid is the page, the card is the row.
 */
export function connectTarget(
  platform: ConnectPlatform,
  accountKey: string | null | undefined,
): ConnectTarget | null {
  if (!accountKey) return null;
  return {
    href: `/settings/subaccounts/${encodeURIComponent(accountKey)}?tab=integrations`,
    label: `Connect ${PLATFORM_LABEL[platform]}`,
  };
}
