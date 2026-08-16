/**
 * Whether each report actually has anything behind it for a given sub-account.
 *
 * Turning a report ON in the allowlist doesn't make it work — most reports are
 * a view onto an integration, and switching one on for a dealer whose Meta ad
 * account was never linked just hands them an empty page. This tells the
 * allowlist screen which switches are real.
 *
 * Three honest states, kept apart because they are different claims:
 *
 *   • `builtin`   — Loomi's own data. Nothing to connect; it always works.
 *   • `connected` — the integration this report needs is configured.
 *   • `missing`   — it isn't, so the report will render empty.
 *
 * Some sources are a configured ID (`metaAdAccountId`), others are the presence
 * of ingested rows (call events, DMS records). Both are reported as
 * `connected`, but `detail` says which, so "connected" never overstates what
 * was actually checked.
 *
 * Server-only.
 */
import { prisma } from '@/lib/prisma';
import { resolveGa4Property } from '@/lib/integrations/account-mapping';
import { REPORTS, type ReportKey } from './reports';

export type SourceState = 'builtin' | 'connected' | 'missing';

export type ReportSource = {
  state: SourceState;
  /** What the reader needs to do, or what was found. One short line. */
  detail: string;
};

/** Reports backed by Loomi's own tables — no integration to miss. */
const BUILTIN: Partial<Record<ReportKey, string>> = {
  contacts: 'Loomi contact data',
  lists: 'Loomi lists and segments',
  engagement: 'Loomi email and text sends',
  leads: 'Loomi lead capture',
  budget: 'Loomi budget ledger',
  executive: 'Rolls up other reports',
  ad_meeting: 'Generated from other reports',
};

export type ReportSourceMap = Record<string, ReportSource>;

/**
 * Resolve every report's source state for one account.
 *
 * One query per data-backed report, all issued together — the screen shows all
 * seventeen at once, so doing them lazily would just be seventeen round trips
 * with a spinner on each.
 */
export async function resolveReportSources(
  accountKey: string,
): Promise<ReportSourceMap> {
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: {
      metaAdAccountId: true,
      googleAdsCustomerId: true,
      stackadaptAdvertiserId: true,
      gbpConnection: { select: { id: true } },
    },
  });

  // GA4's mapping moved from an env map onto `Account.ga4PropertyId`, so
  // resolving it is a query now — issued alongside the counts, not after them.
  const [ga4PropertyId, callEvents, reviews, billboards, mailers, dmsEvents] = await Promise.all([
    resolveGa4Property(accountKey),
    prisma.callEvent.count({ where: { accountKey }, take: 1 }),
    prisma.reviewEvent.count({ where: { accountKey }, take: 1 }),
    prisma.billboard.count({ where: { accountKey }, take: 1 }),
    prisma.mailerCampaign.count({ where: { accountKey }, take: 1 }),
    // `accountKey` sits on ContactEvent directly — the same column the trend
    // queries filter on (src/lib/reporting/dealer-trends.ts), rather than
    // joining through `contact`.
    prisma.contactEvent.count({
      where: { accountKey, type: { in: ['sale', 'service'] } },
      take: 1,
    }),
  ]);

  const configured = (value: string | null | undefined, what: string): ReportSource =>
    value
      ? { state: 'connected', detail: `${what} linked` }
      : { state: 'missing', detail: `No ${what} linked` };

  const ingested = (count: number, what: string): ReportSource =>
    count > 0
      ? { state: 'connected', detail: `${what} received` }
      : { state: 'missing', detail: `No ${what} yet` };

  const sources: ReportSourceMap = {
    ads: configured(account?.metaAdAccountId, 'Meta ad account'),
    google: configured(account?.googleAdsCustomerId, 'Google Ads account'),
    stackadapt: configured(account?.stackadaptAdvertiserId, 'StackAdapt advertiser'),
    websites: configured(ga4PropertyId, 'GA4 property'),
    business_profile: configured(
      account?.gbpConnection?.id ?? null,
      'Google Business Profile',
    ),
    // Reviews arrive through the GBP connection, so that's what to fix — but
    // report on the rows, since a connection with no reviews is still empty.
    reputation: ingested(reviews, 'Review data'),
    call_tracking: ingested(callEvents, 'Call data'),
    billboards: ingested(billboards, 'Billboard placements'),
    direct_mail: ingested(mailers, 'Mail campaigns'),
    sales_trend: ingested(dmsEvents, 'DMS sales/service data'),
    service_trend: ingested(dmsEvents, 'DMS sales/service data'),
    service_retention: ingested(dmsEvents, 'DMS sales/service data'),
    heatmap: ingested(dmsEvents, 'DMS sales/service data'),
  };

  for (const [key, detail] of Object.entries(BUILTIN)) {
    sources[key] = { state: 'builtin', detail: detail! };
  }

  // A report with no entry is a bug — better to say "unknown" than to imply a
  // working integration nobody checked.
  for (const report of REPORTS) {
    sources[report.key] ??= { state: 'missing', detail: 'Source unknown' };
  }

  return sources;
}
