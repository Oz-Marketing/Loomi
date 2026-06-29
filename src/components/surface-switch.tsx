'use client';

import { useEffect, useState } from 'react';
import { Squares2X2Icon, RectangleStackIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import {
  appendThemeParam,
  getAppUrl,
  getCurrentSurface,
  getStudioUrl,
} from '@/lib/cross-site';
import { SidebarTooltip } from '@/components/sidebar-collapsed-ui';

/**
 * Quick switch between the Studio and Projects (App) surfaces — a segmented
 * control pinned in the sidebar. The current surface is highlighted; the other
 * is a cross-host link that carries the theme + active account so you land in
 * the same context. Replaces the old Integrations sidebar link.
 */
export function SurfaceSwitch({ collapsed = false }: { collapsed?: boolean }) {
  const { accountKey } = useAccount();
  const { theme } = useTheme();
  const [active, setActive] = useState<'studio' | 'app'>('studio');
  const [studioUrl, setStudioUrl] = useState<string | null>(null);
  const [appUrl, setAppUrl] = useState<string | null>(null);

  useEffect(() => {
    const surface = getCurrentSurface();
    setActive(surface === 'app' ? 'app' : 'studio');
    const withCtx = (url: string | null) => {
      if (!url) return null;
      let u = appendThemeParam(url, theme);
      if (accountKey) u += `&account=${encodeURIComponent(accountKey)}`;
      return u;
    };
    setStudioUrl(withCtx(getStudioUrl('/')));
    setAppUrl(withCtx(getAppUrl('/projects')));
  }, [theme, accountKey]);

  const items: { key: 'studio' | 'app'; label: string; href: string | null; icon: typeof Squares2X2Icon }[] = [
    { key: 'studio', label: 'Studio', href: studioUrl, icon: Squares2X2Icon },
    { key: 'app', label: 'Projects', href: appUrl, icon: RectangleStackIcon },
  ];

  if (collapsed) {
    // Rail: just the icon for the OTHER surface (one tap to switch).
    const other = active === 'app' ? items[0] : items[1];
    if (!other.href) return null;
    return (
      <SidebarTooltip label={`Switch to ${other.label}`}>
        <a
          href={other.href}
          aria-label={`Switch to ${other.label}`}
          className="flex items-center justify-center rounded-xl px-2 py-2 text-[var(--sidebar-muted-foreground)] transition hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]"
        >
          <other.icon className="h-5 w-5" />
        </a>
      </SidebarTooltip>
    );
  }

  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-[var(--sidebar-border)] bg-[var(--sidebar-muted)]/40 p-0.5">
      {items.map((it) => {
        const isActive = it.key === active;
        const base =
          'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition';
        if (isActive) {
          return (
            <span
              key={it.key}
              aria-current="page"
              className={`${base} bg-[var(--background)] text-[var(--sidebar-foreground)] shadow-sm`}
            >
              <it.icon className="h-4 w-4" />
              {it.label}
            </span>
          );
        }
        return (
          <a
            key={it.key}
            href={it.href ?? '#'}
            className={`${base} text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)]`}
          >
            <it.icon className="h-4 w-4" />
            {it.label}
          </a>
        );
      })}
    </div>
  );
}
