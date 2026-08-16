/**
 * The report registry — which reports exist, what each one needs, and which are
 * offered to clients by default. Client-safe (no prisma).
 *
 * Two separate questions, deliberately kept apart:
 *
 *   1. **Permission** — does this role get to see this KIND of report at all?
 *      Budget and Executive need their own permissions; the rest need
 *      `reporting.report.view`. This is a property of the role.
 *
 *   2. **Allowlist** — does THIS sub-account expose this report to its client
 *      users? A dealer paying for Meta ads and nothing else shouldn't see an
 *      empty Call Tracking report. This is a property of the account, stored in
 *      `AccountReportAccess`, and only ever narrows what the permission allows.
 *
 * Staff bypass the allowlist: it describes what a client is shown, not what an
 * account manager may look at.
 *
 * See docs/permissions-architecture.md.
 */
import type { Permission } from './registry';

export type ReportKey =
  | 'ads'
  | 'google'
  | 'stackadapt'
  | 'billboards'
  | 'budget'
  | 'business_profile'
  | 'call_tracking'
  | 'contacts'
  | 'direct_mail'
  | 'engagement'
  | 'executive'
  | 'heatmap'
  | 'leads'
  | 'lists'
  | 'reputation'
  | 'sales_trend'
  | 'service_retention'
  | 'service_trend'
  | 'websites'
  | 'ad_meeting';

/**
 * How reports cluster in the Reporting sidebar. The allowlist UI groups by the
 * same headings so an admin ticking boxes is looking at the shape of the
 * client's nav, not an alphabetical wall of 17 checkboxes.
 */
export type ReportGroup = 'audience' | 'advertising' | 'presence' | 'sales' | 'internal';

export const REPORT_GROUP_LABELS: Record<ReportGroup, string> = {
  audience: 'Audience',
  advertising: 'Advertising',
  presence: 'Local Presence',
  sales: 'Sales & Service',
  internal: 'Internal',
};

export type ReportDefinition = {
  key: ReportKey;
  label: string;
  group: ReportGroup;
  /** One line, in the words of whoever is deciding whether a dealer gets it. */
  blurb: string;
  /** The permission a role needs to see this report at all. */
  permission: Permission;
  /**
   * Whether a client sees it when the account has no explicit allowlist row.
   *
   * TRUE for every client-eligible report, on purpose. Clients can see all of
   * them today, so anything else would make deploying this change quietly
   * remove reports from live dealers — a narrowing nobody asked for and nobody
   * would attribute to a permissions release.
   *
   * The allowlist is opt-OUT: it does nothing until someone turns something off
   * for a specific sub-account.
   */
  defaultForClients: boolean;
};

export const REPORTS: ReportDefinition[] = [
  { key: 'ads', label: 'Meta Ads', group: 'advertising', blurb: 'Facebook and Instagram paid performance.', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'google', label: 'Google Ads', group: 'advertising', blurb: 'Search, Display and Performance Max.', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'stackadapt', label: 'StackAdapt', group: 'advertising', blurb: 'Programmatic display and connected TV.', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'websites', label: 'Websites', group: 'presence', blurb: 'Sessions, traffic sources and page performance.', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'business_profile', label: 'Business Profile', group: 'presence', blurb: 'Google Business Profile views, searches and actions.', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'reputation', label: 'Reputation', group: 'presence', blurb: 'Review volume, rating trend and response rate.', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'leads', label: 'Lead Performance', group: 'sales', blurb: 'Lead volume and source attribution.', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'contacts', label: 'Contacts', group: 'audience', blurb: 'The contact database for this sub-account.', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'lists', label: 'Marketing Lists', group: 'audience', blurb: 'Marketing lists and segments.', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'engagement', label: 'Engagement', group: 'audience', blurb: 'Email and text sends, plus flow performance.', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'sales_trend', label: 'Sales Trend', group: 'sales', blurb: 'Units sold over time, new and used.', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'service_trend', label: 'Service Trend', group: 'sales', blurb: 'Service RO count and revenue over time.', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'service_retention', label: 'Service Retention', group: 'sales', blurb: 'How many sales customers come back for service.', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'heatmap', label: 'Customer Heatmap', group: 'sales', blurb: 'Where customers come from, geographically.', permission: 'reporting.report.view', defaultForClients: true },

  // Bought by some dealers, not most — the obvious ones to switch off per
  // account. Still default ON: they're visible today, and this release must not
  // be what takes them away.
  { key: 'call_tracking', label: 'Call Tracking', group: 'presence', blurb: 'Tracked inbound calls and their sources.', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'billboards', label: 'Billboards', group: 'presence', blurb: 'Out-of-home placements and estimated impressions.', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'direct_mail', label: 'Direct Mail ROI', group: 'sales', blurb: 'Mail campaign response and attributed revenue.', permission: 'reporting.report.view', defaultForClients: true },

  // Internal. The permission already excludes clients — `defaultForClients:
  // false` is belt-and-braces so an allowlist row can't accidentally expose one.
  { key: 'budget', label: 'Budget', group: 'internal', blurb: 'Spend ledger across every channel. Internal.', permission: 'reporting.budget.view', defaultForClients: false },
  { key: 'executive', label: 'Executive', group: 'internal', blurb: 'Cross-rooftop comparison. Internal.', permission: 'reporting.executive.view', defaultForClients: false },
  { key: 'ad_meeting', label: 'Ad Meeting', group: 'internal', blurb: 'The drafted ad-meeting analysis. Internal.', permission: 'reporting.configure', defaultForClients: false },
];

const BY_KEY = new Map<ReportKey, ReportDefinition>(REPORTS.map((r) => [r.key, r]));

export function reportDefinition(key: ReportKey): ReportDefinition | undefined {
  return BY_KEY.get(key);
}

/**
 * Reports a client could ever be shown — i.e. those gated only by
 * `reporting.report.view`. Budget and Executive can never appear here, whatever
 * an allowlist row says, which is what makes the allowlist UI safe to expose.
 */
export const CLIENT_ELIGIBLE_REPORTS: ReportDefinition[] = REPORTS.filter(
  (r) => r.permission === 'reporting.report.view',
);

export function isClientEligible(key: ReportKey): boolean {
  return CLIENT_ELIGIBLE_REPORTS.some((r) => r.key === key);
}

/**
 * Resolve the effective allowlist for one account from its stored rows.
 *
 * `rows` is whatever `AccountReportAccess` holds for the account; anything
 * absent falls back to `defaultForClients`. Returns the set of report keys a
 * client on that account may see.
 */
export function resolveClientReports(
  rows: { reportKey: string; enabled: boolean }[],
): Set<ReportKey> {
  const explicit = new Map(rows.map((r) => [r.reportKey, r.enabled]));
  const out = new Set<ReportKey>();
  for (const report of CLIENT_ELIGIBLE_REPORTS) {
    const enabled = explicit.get(report.key) ?? report.defaultForClients;
    if (enabled) out.add(report.key);
  }
  return out;
}

/**
 * Where you go to make a report work.
 *
 * Only some reports have somewhere to send you. Meta, Google Ads and StackAdapt
 * are per-account settings with a modal in the Integrations tab; Business
 * Profile is an OAuth connection whose panel lives on the report page itself.
 *
 * The rest have `null` on purpose, and it matters that the UI doesn't invent a
 * button for them:
 *
 *   • Websites (GA4) is mapped agency-wide in `GA4_PROPERTY_MAP`, not per
 *     account — there is no per-account screen to open.
 *   • Reviews, calls, billboards, mail and the DMS trends are INGESTED. Nothing
 *     to connect; the data either arrives or it doesn't.
 *
 * A button that opens the wrong screen is worse than no button, because it
 * implies the fix is one click away when it isn't.
 */
export type ReportIntegration =
  /** Opens a modal in the sub-account's Integrations tab. */
  | { kind: 'modal'; provider: 'facebook' | 'google' | 'stackadapt'; label: string }
  /** Navigates somewhere that hosts the connect flow. */
  | { kind: 'link'; href: string; label: string };

const INTEGRATIONS: Partial<Record<ReportKey, ReportIntegration>> = {
  ads: { kind: 'modal', provider: 'facebook', label: 'Link Meta ad account' },
  google: { kind: 'modal', provider: 'google', label: 'Link Google Ads' },
  stackadapt: { kind: 'modal', provider: 'stackadapt', label: 'Link StackAdapt' },
  business_profile: {
    kind: 'link',
    href: '/reporting/business-profile',
    label: 'Connect Business Profile',
  },
};

export function reportIntegration(key: ReportKey): ReportIntegration | null {
  return INTEGRATIONS[key] ?? null;
}
