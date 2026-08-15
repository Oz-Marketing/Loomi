/**
 * Per-platform roll-up descriptors for the org report roll-up. Each maps a
 * single-account reporting route → the flat metric object it returns → the KPI
 * cards / table columns to show. Field names match the exact response shapes
 * (see src/lib/integrations/*). Additive fields use `kind:'sum'`; rates are
 * `kind:'rate'` and recomputed from summed numerator/denominator.
 */

import {
  CurrencyDollarIcon,
  EyeIcon,
  CursorArrowRaysIcon,
  ChartBarIcon,
  BoltIcon,
  CheckBadgeIcon,
  EnvelopeIcon,
  InboxArrowDownIcon,
  UsersIcon,
  UserPlusIcon,
  DocumentTextIcon,
  StarIcon,
  ChatBubbleLeftRightIcon,
  TruckIcon,
  SparklesIcon,
  ArchiveBoxIcon,
  TagIcon,
  WrenchScrewdriverIcon,
  PhoneIcon,
} from '@heroicons/react/24/outline';
import { usd, num, pctText } from '../ads/_components/shared';
import type { RollupConfig } from './org-report-rollup';

/** Pull a nested flat-metrics object; returns null when absent. */
function pick(obj: unknown, key: string): Record<string, number> | null {
  if (!obj || typeof obj !== 'object') return null;
  const v = (obj as Record<string, unknown>)[key];
  return v && typeof v === 'object' ? (v as Record<string, number>) : null;
}

const rating1 = (v: number) => (v > 0 ? v.toFixed(1) : '—');

/** Meta (Facebook) — /api/reporting/ads → accountMetrics. */
export const META_ROLLUP: RollupConfig = {
  label: 'Meta',
  route: '/api/reporting/ads',
  supportsCompare: true,
  extract: (d) => pick(d, 'accountMetrics'),
  metrics: [
    { key: 'spend', label: 'Spend', kind: 'sum', field: 'spend', format: usd, icon: CurrencyDollarIcon, tone: 'primary' },
    { key: 'impressions', label: 'Impressions', kind: 'sum', field: 'impressions', format: num, icon: EyeIcon, tone: 'sky' },
    { key: 'clicks', label: 'Clicks', kind: 'sum', field: 'clicks', format: num, icon: CursorArrowRaysIcon, tone: 'violet' },
    { key: 'ctr', label: 'CTR', kind: 'rate', numerator: 'clicks', denominator: 'impressions', scale: 100, format: pctText, icon: ChartBarIcon, tone: 'emerald' },
    { key: 'cpc', label: 'CPC', kind: 'rate', numerator: 'spend', denominator: 'clicks', format: usd, icon: BoltIcon, tone: 'amber', lowerIsBetter: true },
    { key: 'conversions', label: 'Conversions', kind: 'sum', field: 'conversions', format: num, icon: CheckBadgeIcon, tone: 'zinc' },
  ],
};

/** StackAdapt (OTT/CTV) — /api/reporting/stackadapt → accountMetrics. */
export const STACKADAPT_ROLLUP: RollupConfig = {
  label: 'OTT / CTV',
  route: '/api/reporting/stackadapt',
  supportsCompare: true,
  extract: (d) => pick(d, 'accountMetrics'),
  metrics: [
    { key: 'spend', label: 'Spend', kind: 'sum', field: 'spend', format: usd, icon: CurrencyDollarIcon, tone: 'primary' },
    { key: 'impressions', label: 'Impressions', kind: 'sum', field: 'impressions', format: num, icon: EyeIcon, tone: 'sky' },
    { key: 'clicks', label: 'Clicks', kind: 'sum', field: 'clicks', format: num, icon: CursorArrowRaysIcon, tone: 'violet' },
    { key: 'ctr', label: 'CTR', kind: 'rate', numerator: 'clicks', denominator: 'impressions', scale: 100, format: pctText, icon: ChartBarIcon, tone: 'emerald' },
    { key: 'cpc', label: 'CPC', kind: 'rate', numerator: 'spend', denominator: 'clicks', format: usd, icon: BoltIcon, tone: 'amber', lowerIsBetter: true },
    { key: 'conversions', label: 'Conversions', kind: 'sum', field: 'conversions', format: num, icon: CheckBadgeIcon, tone: 'zinc' },
  ],
};

/** Google Ads — /api/reporting/google → accountMetrics (cost, avg_cpc). */
export const GOOGLE_ROLLUP: RollupConfig = {
  label: 'Google Ads',
  route: '/api/reporting/google',
  supportsCompare: true,
  extract: (d) => pick(d, 'accountMetrics'),
  metrics: [
    { key: 'spend', label: 'Spend', kind: 'sum', field: 'cost', format: usd, icon: CurrencyDollarIcon, tone: 'primary' },
    { key: 'impressions', label: 'Impressions', kind: 'sum', field: 'impressions', format: num, icon: EyeIcon, tone: 'sky' },
    { key: 'clicks', label: 'Clicks', kind: 'sum', field: 'clicks', format: num, icon: CursorArrowRaysIcon, tone: 'violet' },
    { key: 'ctr', label: 'CTR', kind: 'rate', numerator: 'clicks', denominator: 'impressions', scale: 100, format: pctText, icon: ChartBarIcon, tone: 'emerald' },
    { key: 'cpc', label: 'CPC', kind: 'rate', numerator: 'cost', denominator: 'clicks', format: usd, icon: BoltIcon, tone: 'amber', lowerIsBetter: true },
    { key: 'conversions', label: 'Conversions', kind: 'sum', field: 'conversions', format: num, icon: CheckBadgeIcon, tone: 'zinc' },
  ],
};

/**
 * Email & Text Blasts — /api/reporting/blasts.
 *
 * Repointed from the old standalone email route (now deleted), which carried
 * ONLY the previous provider's sends. Left as it was, the Executive Dashboard
 * would have quietly reported an account's pre-Loomi history as its whole email
 * programme and shown zero for a rooftop that has sent only through Loomi.
 *
 * The extract splices text SEND VOLUME onto the merged email totals. Text
 * carries no opens or clicks — the events don't exist — so the engagement rows
 * below stay email-only rather than acquiring a denominator that grows every
 * time someone sends a text. See lib/reporting/blasts.ts.
 */
export const BLASTS_ROLLUP: RollupConfig = {
  label: 'Email & text',
  route: '/api/reporting/blasts',
  supportsDates: true,
  extract: (d) => {
    const email = pick(d, 'email');
    if (!email) return null;
    const text = pick(d, 'text');
    return { ...email, textSent: text?.sent ?? 0 };
  },
  metrics: [
    { key: 'sent', label: 'Emails sent', kind: 'sum', field: 'sent', format: num, icon: EnvelopeIcon, tone: 'primary' },
    { key: 'delivered', label: 'Delivered', kind: 'sum', field: 'delivered', format: num, icon: InboxArrowDownIcon, tone: 'sky' },
    { key: 'opened', label: 'Opened', kind: 'sum', field: 'uniqueOpens', format: num, icon: EyeIcon, tone: 'violet' },
    { key: 'clicked', label: 'Clicked', kind: 'sum', field: 'uniqueClicks', format: num, icon: CursorArrowRaysIcon, tone: 'amber' },
    { key: 'openRate', label: 'Open rate', kind: 'rate', numerator: 'uniqueOpens', denominator: 'delivered', scale: 100, format: pctText, icon: ChartBarIcon, tone: 'emerald' },
    { key: 'clickRate', label: 'Click rate', kind: 'rate', numerator: 'uniqueClicks', denominator: 'delivered', scale: 100, format: pctText, icon: BoltIcon, tone: 'zinc' },
    { key: 'textSent', label: 'Texts sent', kind: 'sum', field: 'textSent', format: num, icon: ChatBubbleLeftRightIcon, tone: 'zinc' },
  ],
};

/** GA4 — /api/reporting/ga4 → overview (additive traffic metrics). */
export const GA4_ROLLUP: RollupConfig = {
  label: 'Website (GA4)',
  route: '/api/reporting/ga4',
  extract: (d) => pick(d, 'overview'),
  metrics: [
    { key: 'sessions', label: 'Sessions', kind: 'sum', field: 'sessions', format: num, icon: ChartBarIcon, tone: 'primary' },
    { key: 'totalUsers', label: 'Users', kind: 'sum', field: 'totalUsers', format: num, icon: UsersIcon, tone: 'sky' },
    { key: 'newUsers', label: 'New users', kind: 'sum', field: 'newUsers', format: num, icon: UserPlusIcon, tone: 'violet' },
    { key: 'pageViews', label: 'Page views', kind: 'sum', field: 'pageViews', format: num, icon: DocumentTextIcon, tone: 'emerald' },
  ],
};

/**
 * Reputation — /api/reporting/reputation → place (snapshot, no dates).
 * `extract` synthesizes a `ratingWeighted = rating * reviewCount` base so the
 * org rating is a review-count-weighted average, not a naive mean of ratings.
 */
export const REPUTATION_ROLLUP: RollupConfig = {
  label: 'Reputation',
  route: '/api/reporting/reputation',
  supportsDates: false,
  extract: (d) => {
    const place = pick(d, 'place');
    if (!place) return null;
    const rating = typeof place.rating === 'number' ? place.rating : 0;
    const reviewCount = typeof place.reviewCount === 'number' ? place.reviewCount : 0;
    return { reviewCount, ratingWeighted: rating * reviewCount };
  },
  metrics: [
    { key: 'reviewCount', label: 'Reviews', kind: 'sum', field: 'reviewCount', format: num, icon: ChatBubbleLeftRightIcon, tone: 'primary' },
    { key: 'rating', label: 'Avg rating', kind: 'rate', numerator: 'ratingWeighted', denominator: 'reviewCount', format: rating1, icon: StarIcon, tone: 'amber' },
  ],
};

/** Ad-platform report key → roll-up config (the /reporting/ads/[report] tabs). */
export const ADS_ROLLUP_CONFIGS: Record<string, RollupConfig> = {
  meta: META_ROLLUP,
  stackadapt: STACKADAPT_ROLLUP,
  google: GOOGLE_ROLLUP,
  blasts: BLASTS_ROLLUP,
};

// ── Dealer-data roll-ups (Executive Dashboard) ──
//
// The six configs above cover the platform reports. These cover the reports
// built on the Oz Reports bridge, so the Executive Dashboard can roll up the
// whole book of business rather than just the ad channels.
//
// `extract` points at whatever each route nests its account totals under —
// these were written against the actual response shapes, not guessed. Rates are
// always `kind:'rate'` so the roll-up recomputes them from summed numerator and
// denominator: averaging per-rooftop rates would let a store with four repair
// orders swing the group's answer rate as hard as one with four hundred.

/** Sales Trend — /api/reporting/sales-trend → summary. */
export const SALES_ROLLUP: RollupConfig = {
  label: 'Sales',
  route: '/api/reporting/sales-trend',
  supportsDates: true,
  extract: (d) => pick(d, 'summary'),
  metrics: [
    { key: 'totalUnits', label: 'Units', kind: 'sum', field: 'totalUnits', format: num, icon: TruckIcon, tone: 'primary' },
    { key: 'newUnits', label: 'New', kind: 'sum', field: 'newUnits', format: num, icon: SparklesIcon, tone: 'emerald' },
    { key: 'usedUnits', label: 'Used', kind: 'sum', field: 'usedUnits', format: num, icon: ArchiveBoxIcon, tone: 'sky' },
    // Transaction revenue, not dealer gross — the bridge doesn't carry gross.
    { key: 'totalRevenue', label: 'Revenue', kind: 'sum', field: 'totalRevenue', format: usd, icon: CurrencyDollarIcon, tone: 'violet' },
    { key: 'avgPrice', label: 'Avg per unit', kind: 'rate', numerator: 'totalRevenue', denominator: 'totalUnits', format: usd, icon: TagIcon, tone: 'zinc' },
  ],
};

/** Service Trend — /api/reporting/service-trend → summary. */
export const SERVICE_ROLLUP: RollupConfig = {
  label: 'Service',
  route: '/api/reporting/service-trend',
  supportsDates: true,
  extract: (d) => pick(d, 'summary'),
  metrics: [
    { key: 'roCount', label: 'Repair orders', kind: 'sum', field: 'roCount', format: num, icon: WrenchScrewdriverIcon, tone: 'primary' },
    { key: 'totalRevenue', label: 'Revenue', kind: 'sum', field: 'totalRevenue', format: usd, icon: CurrencyDollarIcon, tone: 'violet' },
    { key: 'customerPay', label: 'Customer pay', kind: 'sum', field: 'customerPay', format: usd, icon: UsersIcon, tone: 'emerald' },
    { key: 'warrantyPay', label: 'Warranty', kind: 'sum', field: 'warrantyPay', format: usd, icon: CheckBadgeIcon, tone: 'sky' },
    { key: 'avgRoValue', label: 'Avg per RO', kind: 'rate', numerator: 'totalRevenue', denominator: 'roCount', format: usd, icon: TagIcon, tone: 'zinc' },
  ],
};

/** Call Tracking — /api/reporting/call-tracking → summary. */
export const CALLS_ROLLUP: RollupConfig = {
  label: 'Call tracking',
  route: '/api/reporting/call-tracking',
  supportsDates: true,
  extract: (d) => pick(d, 'summary'),
  metrics: [
    { key: 'calls', label: 'Calls', kind: 'sum', field: 'calls', format: num, icon: PhoneIcon, tone: 'primary' },
    { key: 'answered', label: 'Answered', kind: 'sum', field: 'answered', format: num, icon: CheckBadgeIcon, tone: 'emerald' },
    { key: 'missed', label: 'Missed', kind: 'sum', field: 'missed', format: num, icon: BoltIcon, tone: 'amber', lowerIsBetter: true },
    { key: 'answerRate', label: 'Answer rate', kind: 'rate', numerator: 'answered', denominator: 'calls', scale: 100, format: pctText, icon: ChartBarIcon, tone: 'sky' },
  ],
};

/** Direct Mail ROI — /api/reporting/direct-mail → totals. */
export const DIRECT_MAIL_ROLLUP: RollupConfig = {
  label: 'Direct mail',
  route: '/api/reporting/direct-mail',
  supportsDates: true,
  extract: (d) => pick(d, 'totals'),
  metrics: [
    { key: 'marketed', label: 'Mailed', kind: 'sum', field: 'marketed', format: num, icon: EnvelopeIcon, tone: 'primary' },
    { key: 'matchedCustomers', label: 'Came in', kind: 'sum', field: 'matchedCustomers', format: num, icon: UsersIcon, tone: 'emerald' },
    { key: 'matchbackRate', label: 'Matchback', kind: 'rate', numerator: 'matchedCustomers', denominator: 'marketed', scale: 100, format: pctText, icon: ChartBarIcon, tone: 'sky' },
    { key: 'revenue', label: 'Revenue', kind: 'sum', field: 'revenue', format: usd, icon: CurrencyDollarIcon, tone: 'violet' },
  ],
};

/**
 * Budget — /api/reporting/budget → top-level, so `extract` is identity-ish.
 *
 * No dates: the ledger is annual and the route takes a `year`, so it reports
 * the current one regardless of the range above. The Executive Dashboard says
 * so rather than letting a narrowed range imply a narrowed budget.
 */
export const BUDGET_ROLLUP: RollupConfig = {
  label: 'Budget',
  route: '/api/reporting/budget',
  supportsDates: false,
  extract: (d) =>
    d && typeof d === 'object' ? (d as Record<string, number>) : null,
  metrics: [
    { key: 'planned', label: 'Planned', kind: 'sum', field: 'planned', format: usd, icon: CurrencyDollarIcon, tone: 'primary' },
    { key: 'scheduled', label: 'Scheduled', kind: 'sum', field: 'scheduled', format: usd, icon: CheckBadgeIcon, tone: 'emerald' },
    { key: 'unscheduled', label: 'Unscheduled', kind: 'sum', field: 'unscheduled', format: usd, icon: InboxArrowDownIcon, tone: 'amber' },
  ],
};

/** Every roll-up the Executive Dashboard shows, in display order. */
export const EXECUTIVE_ROLLUPS: RollupConfig[] = [
  GOOGLE_ROLLUP,
  META_ROLLUP,
  STACKADAPT_ROLLUP,
  BLASTS_ROLLUP,
  GA4_ROLLUP,
  REPUTATION_ROLLUP,
  SALES_ROLLUP,
  SERVICE_ROLLUP,
  CALLS_ROLLUP,
  DIRECT_MAIL_ROLLUP,
  BUDGET_ROLLUP,
];
