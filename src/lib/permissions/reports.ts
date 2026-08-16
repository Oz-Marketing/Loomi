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

export type ReportDefinition = {
  key: ReportKey;
  label: string;
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
  { key: 'ads', label: 'Meta Ads', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'google', label: 'Google Ads', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'stackadapt', label: 'StackAdapt', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'websites', label: 'Websites', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'business_profile', label: 'Business Profile', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'reputation', label: 'Reputation', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'leads', label: 'Lead Performance', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'contacts', label: 'Contacts', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'lists', label: 'Marketing Lists', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'engagement', label: 'Engagement', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'sales_trend', label: 'Sales Trend', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'service_trend', label: 'Service Trend', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'service_retention', label: 'Service Retention', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'heatmap', label: 'Customer Heatmap', permission: 'reporting.report.view', defaultForClients: true },

  // Bought by some dealers, not most — the obvious ones to switch off per
  // account. Still default ON: they're visible today, and this release must not
  // be what takes them away.
  { key: 'call_tracking', label: 'Call Tracking', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'billboards', label: 'Billboards', permission: 'reporting.report.view', defaultForClients: true },
  { key: 'direct_mail', label: 'Direct Mail ROI', permission: 'reporting.report.view', defaultForClients: true },

  // Internal. The permission already excludes clients — `defaultForClients:
  // false` is belt-and-braces so an allowlist row can't accidentally expose one.
  { key: 'budget', label: 'Budget', permission: 'reporting.budget.view', defaultForClients: false },
  { key: 'executive', label: 'Executive', permission: 'reporting.executive.view', defaultForClients: false },
  { key: 'ad_meeting', label: 'Ad Meeting', permission: 'reporting.configure', defaultForClients: false },
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
