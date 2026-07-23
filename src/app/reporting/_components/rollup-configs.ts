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

/** Email (GoHighLevel) — /api/reporting/email → stats (total_* + rates). */
export const EMAIL_ROLLUP: RollupConfig = {
  label: 'Email',
  route: '/api/reporting/email',
  extract: (d) => pick(d, 'stats'),
  metrics: [
    { key: 'sent', label: 'Sent', kind: 'sum', field: 'total_sent', format: num, icon: EnvelopeIcon, tone: 'primary' },
    { key: 'delivered', label: 'Delivered', kind: 'sum', field: 'total_delivered', format: num, icon: InboxArrowDownIcon, tone: 'sky' },
    { key: 'opened', label: 'Opened', kind: 'sum', field: 'total_opened', format: num, icon: EyeIcon, tone: 'violet' },
    { key: 'clicked', label: 'Clicked', kind: 'sum', field: 'total_clicked', format: num, icon: CursorArrowRaysIcon, tone: 'amber' },
    { key: 'openRate', label: 'Open rate', kind: 'rate', numerator: 'total_opened', denominator: 'total_delivered', scale: 100, format: pctText, icon: ChartBarIcon, tone: 'emerald' },
    { key: 'clickRate', label: 'Click rate', kind: 'rate', numerator: 'total_clicked', denominator: 'total_delivered', scale: 100, format: pctText, icon: BoltIcon, tone: 'zinc' },
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
  email: EMAIL_ROLLUP,
};
