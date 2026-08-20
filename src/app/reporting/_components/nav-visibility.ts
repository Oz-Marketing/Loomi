/**
 * Which reporting nav entries a given user can actually open.
 *
 * Split out of `reporting-sidebar.tsx` so it can be tested without dragging in
 * Next's client hooks — a bug here silently removes reports from the nav, which
 * is the sort of thing nobody files a ticket about.
 */

/** The shape this needs from a nav row; the sidebar's NavItem satisfies it. */
export type NavLike = {
  href?: string;
  children?: { href: string; soon?: boolean }[];
};

/**
 * Nav destination → the report it opens.
 *
 * Only entries listed here can be hidden. Anything absent (the Dashboard, and
 * the `soon` placeholders that have no route yet) always renders — a missing
 * mapping must never silently remove a link.
 *
 * `/ads/*` children map by their platform key, which is also the report key.
 */
export const HREF_TO_REPORT: Record<string, string> = {
  '/contacts': 'contacts',
  '/lists': 'lists',
  '/websites': 'websites',
  '/business-profile': 'business_profile',
  '/reputation': 'reputation',
  '/call-tracking': 'call_tracking',
  '/billboards': 'billboards',
  '/leads': 'leads',
  '/sales-trend': 'sales_trend',
  '/service-trend': 'service_trend',
  '/service-retention': 'service_retention',
  '/heatmap': 'heatmap',
  '/direct-mail': 'direct_mail',
  '/executive': 'executive',
  '/budget': 'budget',
};

/**
 * Digital Ads platform key → report key. They are NOT the same string, which is
 * exactly the trap: `/ads/meta` is the report the registry calls `ads`, and
 * `/ads/blasts` is `engagement`. Slicing the platform off the href and using it
 * as a report key silently hid Meta Ads from every client.
 *
 * `null` means "not a gated report" — `ad-templates` is an internal view with
 * no registry entry, and must not disappear just because it isn't listed.
 */
export const AD_PLATFORM_TO_REPORT: Record<string, string | null> = {
  meta: 'ads',
  google: 'google',
  stackadapt: 'stackadapt',
  blasts: 'engagement',
  'ad-templates': null,
};

export function reportKeyForHref(href: string): string | null {
  if (href.startsWith('/ads/')) {
    const platform = href.slice('/ads/'.length);
    // An unknown platform is not gated. Better a visible link that 403s than a
    // report that vanishes because someone added a route and forgot this map —
    // and the test below makes forgetting fail CI anyway.
    return AD_PLATFORM_TO_REPORT[platform] ?? null;
  }
  return HREF_TO_REPORT[href] ?? null;
}

/**
 * Drop the entries the caller can't open.
 *
 * `allowed === null` means "not loaded yet" and renders everything — a nav that
 * flickers items away is worse than one that briefly shows a link, and the
 * report routes enforce this properly regardless.
 */
export function visibleNav<T extends NavLike>(items: T[], allowed: Set<string> | null): T[] {
  if (!allowed) return items;
  const permitted = (href: string) => {
    const key = reportKeyForHref(href);
    return key === null || allowed.has(key);
  };

  return items.flatMap((item) => {
    if (!item.children) {
      return item.href && !permitted(item.href) ? [] : [item];
    }
    // A `soon` child has no working route, so it isn't subject to the
    // allowlist — it's a placeholder describing the intended shape.
    const children = item.children.filter((c) => c.soon || permitted(c.href));
    // A group with nothing left in it is a heading that opens onto nothing.
    return children.length === 0 ? [] : [{ ...item, children }];
  });
}

// ── Surface prefix ───────────────────────────────────────────────────
//
// The nav hrefs above are written bare (`/websites`), which is what the
// browser URL looks like on reporting.loomilm.com — the proxy rewrites
// `/websites` → `/reporting/websites` internally and the address bar never
// shows the prefix.
//
// The SAME routes are also reachable on the Studio host under a literal
// `/reporting/*` path (the GBP OAuth callback redirects there, and saved links
// exist). There the address bar DOES carry the prefix, and a bare `/websites`
// resolves against the root app tree — which has no such page. 17 of the 19
// nav destinations have no root-level equivalent, so the whole sidebar 404s,
// and Next prefetches each one on hover.
//
// Kept here rather than inline in the sidebar for the reason at the top of this
// file: it can be tested without dragging in Next's client hooks.

/** `/reporting` when the browser path carries the prefix, otherwise `''`. */
export function surfacePrefixFor(browserPath: string): string {
  return browserPath === '/reporting' || browserPath.startsWith('/reporting/')
    ? '/reporting'
    : '';
}

/** The nav href to actually render, given where the browser currently is. */
export function withSurfacePrefix(browserPath: string, href: string): string {
  return `${surfacePrefixFor(browserPath)}${href}`;
}

/**
 * The browser path normalized back to bare, for active-state matching against
 * the bare hrefs above. Without this, nothing ever highlights on the Studio
 * host — `/reporting/executive`.startsWith('/executive') is false.
 */
export function navPathFor(browserPath: string): string {
  const prefix = surfacePrefixFor(browserPath);
  if (!prefix) return browserPath;
  return browserPath.slice(prefix.length) || '/';
}
