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
  PaperAirplaneIcon,
  RectangleGroupIcon,
} from '@heroicons/react/24/outline';
import type { DateRangeKey } from './shared';
import type { ReportLens } from '../../_components/lens';

export interface ReportComponentProps {
  accountKey: string;
  from: string;
  to: string;
  compareTo: string;
  isDark: boolean;
  onJump: (k: DateRangeKey) => void;
  /**
   * Which audience this render is for. Sections that exist to drive an
   * optimization decision render only under 'team'; see _components/lens.tsx.
   */
  lens: ReportLens;
}

export interface ReportDef {
  /** URL slug + stable key, e.g. "meta" → /reporting/ads/meta. */
  key: string;
  label: string;
  blurb: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** 'live' is navigable; 'soon' shows as a disabled nav row. */
  status: 'live' | 'soon';
  /**
   * Set when the report reads nothing account-specific, so the route shows it at
   * Admin scope instead of the "Pick an account" gate.
   *
   * Platform reports all query one account's ad platform and are meaningless
   * without a key — hence the gate being the default. A LIBRARY report is the
   * opposite: the whole point is the view across every account.
   */
  accountOptional?: boolean;
  /**
   * Agency-only. The report is about how WE work, not how the client's money
   * performed, so it is hidden from the nav and refused by the route for the
   * `client` role rather than merely reduced by the team lens.
   *
   * The lens answers "how much detail"; this answers "whose report is it".
   * Ad Templates is the clear case: it ranks template usage ACROSS every
   * account, so showing it to one client would expose the shape of the
   * agency's work for all the others.
   */
  internal?: boolean;
}

export const DIGITAL_ADS_REPORTS: ReportDef[] = [
  { key: 'meta', label: 'Meta', blurb: 'Facebook & Instagram paid performance', icon: MegaphoneIcon, status: 'live' },
  { key: 'stackadapt', label: 'OTT / CTV', blurb: 'StackAdapt programmatic display & connected TV', icon: TvIcon, status: 'live' },
  { key: 'google', label: 'Google Ads', blurb: 'Search, Display & Performance Max', icon: MagnifyingGlassIcon, status: 'live' },
  // Replaces the old email-only report. Covers Loomi email + text sends and
  // the email history carried over from the provider used before Loomi — see
  // lib/reporting/blasts.ts. The previous vendor is never named in the UI.
  { key: 'blasts', label: 'Email & Text Blasts', blurb: 'Email and text sends, plus flow performance', icon: PaperAirplaneIcon, status: 'live' },
  { key: 'ad-templates', label: 'Ad Templates', blurb: 'Which ad templates get used, by hand and by the automation', icon: RectangleGroupIcon, status: 'live', accountOptional: true, internal: true },
];

/**
 * Deep link to the Ad Templates report, optionally focused on one template.
 *
 * Lives here rather than in the templates library so the URL shape is owned by
 * the report that has to read it — the library just asks for a link.
 */
export function templateReportHref(templateId?: string, accountKey?: string): string {
  const q = new URLSearchParams();
  if (templateId) q.set('template', templateId);
  if (accountKey) q.set('account', accountKey);
  const s = q.toString();
  return `/reporting/ads/ad-templates${s ? `?${s}` : ''}`;
}

export function findReport(key: string): ReportDef | undefined {
  return DIGITAL_ADS_REPORTS.find((r) => r.key === key);
}

/** Live reports only — used for the tab bar (you can't open a "soon" report). */
export const LIVE_REPORTS = DIGITAL_ADS_REPORTS.filter((r) => r.status === 'live');

/**
 * The reports a given role may see. Client users lose the `internal` ones
 * entirely — from the nav, the tab bar, and the route.
 */
export function visibleReports(isClient: boolean): ReportDef[] {
  return isClient ? DIGITAL_ADS_REPORTS.filter((r) => !r.internal) : DIGITAL_ADS_REPORTS;
}
