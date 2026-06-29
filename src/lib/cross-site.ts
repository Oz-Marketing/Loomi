/**
 * Append a `?theme=<value>` query param onto a URL, merging with any
 * existing query string. Used by cross-surface links to carry theme
 * between hosts in dev where cookies can't span localhost subdomains.
 * The destination's ThemeProvider consumes + strips it on mount.
 */
export function appendThemeParam(url: string, theme: 'dark' | 'light'): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}theme=${theme}`;
}

/**
 * Compute the URL of the "other" Loomi surface (studio ↔ reporting)
 * based on the current hostname. Used by the user dropdown to offer a
 * one-click jump between the two apps in either environment.
 *
 * Examples (no path):
 *   studio.loomilm.com       → https://reporting.loomilm.com
 *   reporting.loomilm.com    → https://studio.loomilm.com
 *   reporting.localhost:3000 → http://localhost:3000        (studio in dev)
 *   localhost:3000           → http://reporting.localhost:3000
 *
 * Pass `path` to deep-link into a specific route on the other surface:
 *   getOtherSurfaceUrl('/settings') from reporting → https://studio.loomilm.com/settings
 *
 * Returns `null` on SSR (no window) so callers can render nothing or a
 * disabled state until hydration.
 */
export function getOtherSurfaceUrl(path: string = ''): string | null {
  if (typeof window === 'undefined') return null;
  const { protocol, host } = window.location;
  // Normalize path: ensure leading slash, drop trailing slashes
  const normalizedPath =
    path === '' ? '' : path.startsWith('/') ? path : `/${path}`;

  if (host.startsWith('studio.')) {
    return `${protocol}//reporting.${host.slice('studio.'.length)}${normalizedPath}`;
  }
  if (host.startsWith('reporting.')) {
    // Strip the reporting prefix — the studio surface lives on the bare
    // domain in prod (studio.*) and on bare localhost in dev.
    const rest = host.slice('reporting.'.length);
    const base = rest.startsWith('localhost')
      ? `${protocol}//${rest}`
      : `${protocol}//studio.${rest}`;
    return `${base}${normalizedPath}`;
  }
  // Bare localhost in dev = studio side → cross-link to reporting.localhost
  if (host === 'localhost' || host.startsWith('localhost:')) {
    return `${protocol}//reporting.${host}${normalizedPath}`;
  }
  return null;
}

/**
 * Absolute URL of the Studio surface, computed from the current host —
 * works from any surface (studio / reporting / app). Used by the App
 * surface's user dropdown to jump back to Studio. Returns null on SSR.
 *
 *   app.loomilm.com        → https://studio.loomilm.com
 *   app.localhost:3000     → http://localhost:3000
 *   reporting.loomilm.com  → https://studio.loomilm.com
 */
export function getStudioUrl(path: string = ''): string | null {
  if (typeof window === 'undefined') return null;
  const { protocol, host } = window.location;
  const p = path === '' ? '' : path.startsWith('/') ? path : `/${path}`;
  // Prefer the server-provided studio origin (set from NEXTAUTH_URL by the App
  // layout). It's authoritative across host topologies — prod's sibling
  // `studio.loomilm.com` vs staging's bare `staging.loomilm.com` — where the
  // prefix-stripping fallback below would otherwise guess wrong.
  const explicit = (window as unknown as { __LOOMI_STUDIO_ORIGIN__?: string }).__LOOMI_STUDIO_ORIGIN__;
  if (typeof explicit === 'string' && explicit) return `${explicit}${p}`;
  for (const prefix of ['app.', 'reporting.', 'studio.']) {
    if (host.startsWith(prefix)) {
      const rest = host.slice(prefix.length);
      // studio lives on the bare domain in dev (localhost) and on studio.* in prod
      const base = rest.startsWith('localhost')
        ? `${protocol}//${rest}`
        : `${protocol}//studio.${rest}`;
      return `${base}${p}`;
    }
  }
  if (host === 'localhost' || host.startsWith('localhost:')) {
    return `${protocol}//${host}${p}`;
  }
  return null;
}

/**
 * Absolute URL of the App surface (Projects + Reporting), computed from
 * the current host. Used by the Studio sidebar to cross-link into App.
 * Returns null on SSR.
 *
 *   studio.loomilm.com → https://app.loomilm.com
 *   localhost:3000     → http://app.localhost:3000
 */
export function getAppUrl(path: string = ''): string | null {
  if (typeof window === 'undefined') return null;
  const { protocol, host } = window.location;
  const p = path === '' ? '' : path.startsWith('/') ? path : `/${path}`;
  // Prefer the server-published app host (set from APP_SURFACE_HOST by the root
  // layout). It's authoritative where the sibling-subdomain convention doesn't
  // hold — staging's `staging.loomilm.com` ↔ `app-staging.loomilm.com` — where
  // the prefix-swap fallback below returns null (a dead Projects link).
  const explicit = (window as unknown as { __LOOMI_APP_HOST__?: string }).__LOOMI_APP_HOST__;
  if (typeof explicit === 'string' && explicit) return `${protocol}//${explicit}${p}`;
  for (const prefix of ['studio.', 'reporting.']) {
    if (host.startsWith(prefix)) {
      return `${protocol}//app.${host.slice(prefix.length)}${p}`;
    }
  }
  if (host.startsWith('app.')) return `${protocol}//${host}${p}`;
  if (host === 'localhost' || host.startsWith('localhost:')) {
    return `${protocol}//app.${host}${p}`;
  }
  return null;
}

/** Which surface we are currently on. */
export function getCurrentSurface(): 'studio' | 'reporting' | 'app' | null {
  if (typeof window === 'undefined') return null;
  const host = window.location.host;
  if (host.startsWith('reporting.')) return 'reporting';
  // Match the server-published app host first — staging's `app-staging.*` does
  // NOT start with `app.`, so the prefix check below would misread it as studio.
  const appHost = (window as unknown as { __LOOMI_APP_HOST__?: string }).__LOOMI_APP_HOST__;
  if (appHost && host.toLowerCase() === appHost.toLowerCase()) return 'app';
  if (host.startsWith('app.')) return 'app';
  return 'studio';
}
