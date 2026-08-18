/**
 * Resolving App-surface links whether or not the proxy is in front of them.
 *
 * The App surface lives at `src/app/app/*`, so Next serves it at `/app/...`.
 * In production the App host proxies the bare path onto it — a browser on
 * `app.loomilm.com/projects` is served `/app/projects` without the URL ever
 * showing it — so nav hrefs are written bare.
 *
 * Locally there is no proxy: everything is `localhost:3000`, and the only
 * working path IS `/app/projects`. A bare href 404s. That made every App-surface
 * link dead in local dev, which is why `/playbooks` could not be opened without
 * knowing to type the prefix.
 *
 * The current pathname tells us which world we are in, because the proxy is
 * exactly what decides whether `/app` is visible. Mirror it:
 *
 *   production  `/projects`      → prefix ''      → href `/projects`
 *   local       `/app/projects`  → prefix '/app'  → href `/app/projects`
 *
 * Active-state comparison wants the opposite direction — nav items are declared
 * with bare hrefs — so `normalizeAppPath` strips the prefix back off before
 * comparing. Prefix for navigation, normalize for comparison.
 */

/** `/app` when the URL carries the un-proxied prefix, otherwise ''. */
export function appSurfacePrefix(pathname: string): '' | '/app' {
  return pathname === '/app' || pathname.startsWith('/app/') ? '/app' : '';
}

/** A pathname in the bare form nav hrefs are declared in. */
export function normalizeAppPath(pathname: string): string {
  const prefix = appSurfacePrefix(pathname);
  if (!prefix) return pathname;
  return pathname.slice(prefix.length) || '/';
}

/** Prefix an App-surface href to match the current URL's form. */
export function appHref(pathname: string, href: string): string {
  return `${appSurfacePrefix(pathname)}${href}`;
}
