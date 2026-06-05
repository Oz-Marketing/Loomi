/**
 * Digital Ads report registry — METADATA ONLY (no component imports), so it's
 * cheap to pull into the sidebar/nav without dragging the chart-heavy report
 * components into the global chrome bundle. The key→component map lives in
 * report-components.tsx and is imported only by the [report] route.
 *
 * Single source of truth for the sidebar dropdown, the per-report tab bar, and
 * the /reporting/ads/[report] routes. Adding a platform is one entry here; flip
 * `status` to 'live' and add its component to report-components.tsx.
 */

import type { ComponentType, SVGProps } from 'react';
import {
  MegaphoneIcon,
  TvIcon,
  MagnifyingGlassIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline';
import type { DateRangeKey } from './shared';

export interface ReportComponentProps {
  accountKey: string;
  from: string;
  to: string;
  compareTo: string;
  isDark: boolean;
  onJump: (k: DateRangeKey) => void;
}

export interface ReportDef {
  /** URL slug + stable key, e.g. "meta" → /reporting/ads/meta. */
  key: string;
  label: string;
  blurb: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** 'live' is navigable; 'soon' shows as a disabled nav row. */
  status: 'live' | 'soon';
}

export const DIGITAL_ADS_REPORTS: ReportDef[] = [
  { key: 'meta', label: 'Meta', blurb: 'Facebook & Instagram paid performance', icon: MegaphoneIcon, status: 'live' },
  { key: 'stackadapt', label: 'OTT / CTV', blurb: 'StackAdapt programmatic display & connected TV', icon: TvIcon, status: 'live' },
  { key: 'google', label: 'Google Ads', blurb: 'Search, Display & Performance Max', icon: MagnifyingGlassIcon, status: 'live' },
  { key: 'email', label: 'Email Campaigns', blurb: 'GoHighLevel email performance', icon: EnvelopeIcon, status: 'soon' },
];

export function findReport(key: string): ReportDef | undefined {
  return DIGITAL_ADS_REPORTS.find((r) => r.key === key);
}

/** Live reports only — used for the tab bar (you can't open a "soon" report). */
export const LIVE_REPORTS = DIGITAL_ADS_REPORTS.filter((r) => r.status === 'live');
