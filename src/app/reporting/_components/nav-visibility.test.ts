import { describe, it, expect } from 'vitest';
import {
  AD_PLATFORM_TO_REPORT,
  HREF_TO_REPORT,
  navPathFor,
  reportKeyForHref,
  surfacePrefixFor,
  visibleNav,
  withSurfacePrefix,
} from './nav-visibility';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { REPORTS } from '@/lib/permissions/reports';
import { DIGITAL_ADS_REPORTS } from '../ads/_components/reports-config';

const NAV = [
  { key: 'dashboard', href: '/' },
  { key: 'contacts', href: '/contacts' },
  {
    key: 'digital-ads',
    children: [
      { href: '/ads/meta' },
      { href: '/ads/google' },
      { href: '/ads/tiktok', soon: true },
    ],
  },
  {
    key: 'local-presence',
    children: [{ href: '/call-tracking' }, { href: '/billboards' }],
  },
  { key: 'budget', href: '/budget' },
];

const keys = (items: { key: string }[]) => items.map((i) => i.key);

describe('reporting nav visibility', () => {
  /**
   * The mapping is the failure point. A typo'd key isn't in the allowed set, so
   * the entry disappears from the nav for everyone the moment the fetch lands —
   * with nothing on screen saying why.
   */
  it('only maps hrefs to reports that exist', () => {
    const known = new Set<string>(REPORTS.map((r) => r.key));
    for (const [href, key] of Object.entries(HREF_TO_REPORT)) {
      expect(known.has(key), `${href} → unknown report "${key}"`).toBe(true);
    }
  });

  /**
   * The `/ads/*` branch is where this already went wrong: the nav's platform
   * key and the report key are different strings (`meta` vs `ads`), so slicing
   * the href hid Meta Ads from every client. Both directions are pinned.
   */
  it('maps every ad platform to a report that exists', () => {
    const known = new Set<string>(REPORTS.map((r) => r.key));
    for (const [platform, key] of Object.entries(AD_PLATFORM_TO_REPORT)) {
      if (key === null) continue;
      expect(known.has(key), `/ads/${platform} → unknown report "${key}"`).toBe(true);
    }
  });

  it('covers every ad platform the nav actually renders', () => {
    for (const report of DIGITAL_ADS_REPORTS) {
      expect(
        Object.prototype.hasOwnProperty.call(AD_PLATFORM_TO_REPORT, report.key),
        `/ads/${report.key} has no entry — it would never be gated`,
      ).toBe(true);
    }
  });

  it('reads the ad-platform key out of the href', () => {
    // `meta` the platform is `ads` the report — not the same string.
    expect(reportKeyForHref('/ads/meta')).toBe('ads');
    expect(reportKeyForHref('/ads/blasts')).toBe('engagement');
    expect(reportKeyForHref('/contacts')).toBe('contacts');
    // Unmapped destinations are not reports and must never be hidden.
    expect(reportKeyForHref('/')).toBeNull();
  });

  it('renders everything before the allowed set loads', () => {
    expect(keys(visibleNav(NAV, null))).toEqual(keys(NAV));
  });

  it('hides entries whose report is not allowed', () => {
    const out = visibleNav(NAV, new Set(['contacts', 'ads', 'call_tracking']));
    expect(keys(out)).toEqual(['dashboard', 'contacts', 'digital-ads', 'local-presence']);
    // Budget is gone; so is the Google child and the Billboards child.
    expect(out.find((i) => i.key === 'local-presence')!.children).toEqual([
      { href: '/call-tracking' },
    ]);
  });

  it('keeps the Dashboard, which maps to no report', () => {
    expect(keys(visibleNav(NAV, new Set()))).toContain('dashboard');
  });

  it('keeps `soon` placeholders, which have no route to gate', () => {
    const out = visibleNav(NAV, new Set(['ads']));
    const ads = out.find((i) => i.key === 'digital-ads')!;
    expect(ads.children).toEqual([{ href: '/ads/meta' }, { href: '/ads/tiktok', soon: true }]);
  });

  it('drops a group once every child is hidden', () => {
    const out = visibleNav(NAV, new Set(['contacts']));
    expect(keys(out)).not.toContain('local-presence');
  });
});

describe('surface prefix', () => {
  it('leaves hrefs bare on the reporting host, where the proxy rewrites', () => {
    // Address bar reads `/executive`; the /reporting rewrite is internal.
    expect(surfacePrefixFor('/executive')).toBe('');
    expect(withSurfacePrefix('/executive', '/websites')).toBe('/websites');
  });

  it('prefixes hrefs when the browser path already carries /reporting', () => {
    // Studio host: `/websites` would resolve against the ROOT tree and 404.
    expect(surfacePrefixFor('/reporting/executive')).toBe('/reporting');
    expect(withSurfacePrefix('/reporting/executive', '/websites')).toBe('/reporting/websites');
  });

  it('handles the bare /reporting root', () => {
    expect(surfacePrefixFor('/reporting')).toBe('/reporting');
    expect(withSurfacePrefix('/reporting', '/')).toBe('/reporting/');
    expect(navPathFor('/reporting')).toBe('/');
  });

  it('does not claim a path that merely starts with the same letters', () => {
    // `/reporting-archive` is not the reporting surface.
    expect(surfacePrefixFor('/reporting-archive')).toBe('');
  });

  it('normalizes the path back to bare so active-state matching still works', () => {
    expect(navPathFor('/reporting/ads/meta')).toBe('/ads/meta');
    expect(navPathFor('/ads/meta')).toBe('/ads/meta');
  });

  // The bug this all exists for: every gated nav destination must resolve to a
  // real page under app/reporting. A `/websites` entry pointing at a directory
  // with no page.tsx is a 404 the nav prefetches on hover.
  it('every gated nav href resolves to a real reporting page', () => {
    const reportingDir = path.join(__dirname, '..');
    const missing = Object.keys(HREF_TO_REPORT).filter(
      (href) => !existsSync(path.join(reportingDir, href, 'page.tsx')),
    );
    expect(missing).toEqual([]);
  });
});
