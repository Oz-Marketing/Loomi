'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useSession } from 'next-auth/react';
import {
  DEFAULT_APPEARANCE,
  applyAppearanceToDocument,
  decodeAppearance,
  encodeAppearance,
  isThemePreference,
  normalizeAppearance,
  type AppearancePrefs,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/appearance/presets';

/**
 * Appearance persistence:
 *  - Writes a `document.cookie` scoped to `.loomilm.com` in prod so the
 *    same look follows the user across studio + reporting subdomains.
 *    (localStorage is per-origin and doesn't share between subdomains.)
 *  - Falls back to `localStorage` on dev/non-https so devs still get
 *    persistence within a single host.
 *  - Mirrors to `UserAppearancePreference` in the DB for signed-in users, so
 *    preferences follow the person to a new machine. The cookie stays the fast
 *    path — it applies before the first paint; the DB row reconciles just after
 *    mount and wins when the two disagree.
 *  - Reads on mount in this order: ?theme= → cookie → localStorage → defaults,
 *    then the DB row once the session resolves.
 */
const STORAGE_KEY = 'loomi-appearance';
const COOKIE_NAME = 'loomi-appearance';
/** The pre-personalization cookie/key. Read once to migrate old visitors. */
const LEGACY_KEY = 'loomi-theme';
// One year in seconds — appearance is a sticky preference.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** Coalesce rapid changes (dragging through swatches) into one write. */
const SAVE_DEBOUNCE_MS = 600;

interface ThemeContextValue {
  /** The theme actually painted — 'system' already resolved. Consumers that
   *  branch on light/dark (charts, logos, the toaster) want this one. */
  theme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  toggleTheme: () => void;
  /** The raw stored choice, including 'system'. */
  themePreference: ThemePreference;
  appearance: AppearancePrefs;
  setAppearance: (patch: Partial<AppearancePrefs>) => void;
  resetAppearance: () => void;
  /** True once the DB row (if any) has been reconciled. */
  synced: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

function writeCookie(name: string, value: string): void {
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
    `${name}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${domain}${secure}`;
}

/** Consume a `?theme=<value>` query param if present and strip it. Used
 *  by cross-surface links to carry theme between hosts in environments
 *  where cookie sharing is unavailable (e.g. dev: cookies can't span
 *  localhost ↔ reporting.localhost). */
function consumeThemeQueryParam(): ThemePreference | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get('theme');
  if (!isThemePreference(value)) return null;
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

/**
 * Read whatever this browser already knows, newest format first. The legacy
 * `loomi-theme` cookie held a bare 'dark'/'light' — honour it so existing users
 * don't get silently flipped to the new 'system' default on first load after
 * this ships.
 */
function loadLocalAppearance(): AppearancePrefs {
  if (typeof window === 'undefined') return DEFAULT_APPEARANCE;

  const fromQuery = consumeThemeQueryParam();

  let base: AppearancePrefs | null =
    decodeAppearance(readCookie(COOKIE_NAME)) ?? null;

  if (!base) {
    try {
      base = decodeAppearance(localStorage.getItem(STORAGE_KEY));
    } catch {}
  }

  if (!base) {
    // Pre-personalization visitor: carry their old theme forward as an explicit
    // choice rather than defaulting them to 'system'.
    let legacy = readCookie(LEGACY_KEY);
    if (!legacy) {
      try {
        legacy = localStorage.getItem(LEGACY_KEY);
      } catch {}
    }
    if (legacy === 'dark' || legacy === 'light') {
      base = { ...DEFAULT_APPEARANCE, theme: legacy };
    }
  }

  const prefs = base ?? DEFAULT_APPEARANCE;
  // The URL param is an active handoff — it outranks anything stored.
  return fromQuery ? { ...prefs, theme: fromQuery } : prefs;
}

function persistLocally(prefs: AppearancePrefs): void {
  const encoded = encodeAppearance(prefs);
  writeCookie(COOKIE_NAME, encoded);
  try {
    localStorage.setItem(STORAGE_KEY, encoded);
  } catch {}
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [appearance, setAppearanceState] = useState<AppearancePrefs>(DEFAULT_APPEARANCE);
  const [systemDark, setSystemDark] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [synced, setSynced] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Suppresses the write-back that would otherwise fire when the DB reconcile
   *  sets state — adopting the server's row is not a user edit. */
  const skipNextSave = useRef(false);

  useEffect(() => {
    setAppearanceState(loadLocalAppearance());
    setHydrated(true);
  }, []);

  // Track the OS setting so `theme: 'system'` re-resolves live when the user
  // flips their OS appearance with Loomi open.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme = useMemo(
    () =>
      appearance.theme === 'system'
        ? systemDark
          ? 'dark'
          : 'light'
        : appearance.theme,
    [appearance.theme, systemDark],
  );

  // Paint + local persistence. Runs on every change, including the DB adopt.
  useEffect(() => {
    if (!hydrated) return;
    applyAppearanceToDocument(appearance, resolved);
    persistLocally(appearance);
  }, [appearance, resolved, hydrated]);

  // Reconcile with the DB once we know who the user is. The server row is the
  // cross-device truth, so it wins on load; if the user has no row yet we seed
  // it from whatever this browser already had, so their existing theme choice
  // is captured rather than overwritten by defaults.
  useEffect(() => {
    if (!hydrated || status !== 'authenticated' || synced) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/appearance');
        if (!res.ok) return;
        const data = (await res.json()) as { stored?: boolean; appearance?: unknown };
        if (cancelled) return;
        if (data.stored) {
          skipNextSave.current = true;
          setAppearanceState(normalizeAppearance(data.appearance));
        } else {
          // No row yet — seed one from this browser's current state.
          void fetch('/api/appearance', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appearance),
          });
        }
      } catch {
        // Offline or the route is unavailable — local persistence still holds.
      } finally {
        if (!cancelled) setSynced(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `appearance` is deliberately omitted: this must run once per session
    // resolution, not on every preference change (which would re-seed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, status, synced]);

  // Write-through to the DB, debounced so dragging across swatches is one save.
  useEffect(() => {
    if (!hydrated || !synced || status !== 'authenticated') return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void fetch('/api/appearance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appearance),
      }).catch(() => {
        // Non-fatal: the cookie already holds the change on this device.
      });
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [appearance, hydrated, synced, status]);

  const setAppearance = useCallback((patch: Partial<AppearancePrefs>) => {
    setAppearanceState((prev) => normalizeAppearance({ ...prev, ...patch }));
  }, []);

  const setTheme = useCallback(
    (t: ThemePreference) => setAppearanceState((prev) => ({ ...prev, theme: t })),
    [],
  );

  // Toggling from 'system' commits to the opposite of what's currently painted,
  // so one click always visibly flips — rather than being a no-op when the OS
  // already matches the value we'd have chosen.
  const toggleTheme = useCallback(() => {
    setAppearanceState((prev) => {
      const current = prev.theme === 'system' ? resolved : prev.theme;
      return { ...prev, theme: current === 'dark' ? 'light' : 'dark' };
    });
  }, [resolved]);

  const resetAppearance = useCallback(
    () => setAppearanceState(DEFAULT_APPEARANCE),
    [],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: resolved,
      setTheme,
      toggleTheme,
      themePreference: appearance.theme,
      appearance,
      setAppearance,
      resetAppearance,
      synced,
    }),
    [resolved, setTheme, toggleTheme, appearance, setAppearance, resetAppearance, synced],
  );

  if (!hydrated) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

/** Alias for call sites that care about the whole appearance set, not just the
 *  painted theme. Same context — named for what it reads. */
export const useAppearance = useTheme;
