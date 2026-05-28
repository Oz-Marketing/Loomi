'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

/**
 * Theme persistence:
 *  - Writes a `document.cookie` scoped to `.loomilm.com` in prod so the
 *    same theme follows the user across studio + reporting subdomains.
 *    (localStorage is per-origin and doesn't share between subdomains.)
 *  - Falls back to `localStorage` on dev/non-https so devs still get
 *    persistence within a single host.
 *  - Reads on mount in this order: cookie → localStorage → 'light'.
 */
const STORAGE_KEY = 'loomi-theme';
const COOKIE_NAME = 'loomi-theme';
// One year in seconds — themes are sticky preferences.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readCookieTheme(): Theme | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const value = match.slice(COOKIE_NAME.length + 1);
  return value === 'dark' || value === 'light' ? value : null;
}

function writeCookieTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  // In prod (HTTPS on a real domain) scope to `.loomilm.com` so the
  // cookie covers studio + reporting + future subdomains. In dev the
  // host is `localhost` / `reporting.localhost` which sit on the
  // public-suffix-blocked TLD — cookies with `Domain=.localhost` get
  // rejected by browsers. Omit the domain attribute there so the
  // cookie scopes to the exact host. Cross-subdomain sharing in dev
  // isn't a goal; localStorage handles per-host persistence.
  const onSecureHost =
    typeof window !== 'undefined' && window.location.protocol === 'https:';
  const domain = onSecureHost ? '; Domain=.loomilm.com' : '';
  const secure = onSecureHost ? '; Secure' : '';
  document.cookie =
    `${COOKIE_NAME}=${theme}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${domain}${secure}`;
}

/** Consume a `?theme=<value>` query param if present and strip it. Used
 *  by cross-surface links to carry theme between hosts in environments
 *  where cookie sharing is unavailable (e.g. dev: cookies can't span
 *  localhost ↔ reporting.localhost). */
function consumeThemeQueryParam(): Theme | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get('theme');
  if (value !== 'dark' && value !== 'light') return null;
  // Strip the param so refreshing the page doesn't keep "locking" theme.
  params.delete('theme');
  const newQuery = params.toString();
  window.history.replaceState(
    {},
    '',
    window.location.pathname +
      (newQuery ? `?${newQuery}` : '') +
      window.location.hash,
  );
  return value;
}

function loadTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  // URL param wins (active cross-surface handoff), then cookie
  // (cross-subdomain persistence in prod), then localStorage
  // (per-host fallback for dev / older browsers).
  const fromQuery = consumeThemeQueryParam();
  if (fromQuery) return fromQuery;
  const fromCookie = readCookieTheme();
  if (fromCookie) return fromCookie;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setThemeState(loadTheme());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.setAttribute('data-theme', theme);
    // Write to both: cookie carries across subdomains (the cross-surface
    // requirement); localStorage covers older browsers + dev edge cases.
    writeCookieTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
  }, [theme, hydrated]);

  const setTheme = (t: Theme) => setThemeState(t);
  const toggleTheme = () => setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));

  if (!hydrated) return null;

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
