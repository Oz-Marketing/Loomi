'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Shared sidebar collapse state. One source of truth that the sidebar
 * (toggle source + width) and the main content area (left padding)
 * both read from, on either surface (studio + reporting).
 *
 * Persisted to localStorage so the preference survives reloads.
 *
 * NOTE: SSR + hydration. On first render `collapsed` is `false`
 * (expanded). After mount, the hook reads localStorage and may flip
 * the state. Components that depend on this state will reflow once —
 * the flicker is short enough to tolerate without a head-script
 * pre-set; if it becomes noticeable, we can pre-emit a data-attribute
 * on <html> the way the theme provider does.
 */
const STORAGE_KEY = 'loomi-sidebar-collapsed';

interface SidebarCollapseContextValue {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
  /** Mobile off-canvas drawer state (not persisted — session-only). */
  mobileOpen: boolean;
  setMobileOpen: (value: boolean) => void;
}

const SidebarCollapseContext = createContext<SidebarCollapseContextValue | null>(null);

export function SidebarCollapseProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState<boolean>(false);
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);

  // Read persisted value once on mount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'true') setCollapsedState(true);
    } catch {
      /* localStorage unavailable — fine, default to expanded */
    }
  }, []);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
    } catch {
      /* ignore — state still updates in-memory */
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  return (
    <SidebarCollapseContext.Provider value={{ collapsed, toggle, setCollapsed, mobileOpen, setMobileOpen }}>
      {children}
    </SidebarCollapseContext.Provider>
  );
}

export function useSidebarCollapse(): SidebarCollapseContextValue {
  const ctx = useContext(SidebarCollapseContext);
  if (!ctx) {
    // Safe fallback: if a component outside the provider tries to read,
    // pretend the sidebar is expanded (no-op toggle). Avoids crashes in
    // edge cases like Storybook or isolated tests.
    return {
      collapsed: false,
      toggle: () => {},
      setCollapsed: () => {},
      mobileOpen: false,
      setMobileOpen: () => {},
    };
  }
  return ctx;
}
