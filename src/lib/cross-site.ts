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

/** Which surface we are currently on. */
export function getCurrentSurface(): 'studio' | 'reporting' | null {
  if (typeof window === 'undefined') return null;
  return window.location.host.startsWith('reporting.') ? 'reporting' : 'studio';
}
