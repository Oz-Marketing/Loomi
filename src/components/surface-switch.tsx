'use client';

import { useEffect, useState } from 'react';
import { Squares2X2Icon, RectangleStackIcon, ChartBarSquareIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import {
  appendThemeParam,
  getAppUrl,
  getCurrentSurface,
  getReportingUrl,
  getStudioUrl,
} from '@/lib/cross-site';
import { SidebarTooltip } from '@/components/sidebar-collapsed-ui';

type Surface = 'studio' | 'reporting' | 'app';

/**
 * Quick switch between the three peer surfaces — Studio, Reporting, and
 * Projects (App) — a segmented control pinned in the sidebar. The current
 * surface is highlighted; the others are cross-host links that carry the theme
 * + active account so you land in the same scope. Reporting is a first-class
 * peer (scope-driven analytics), no longer a one-off crosslink.
 */
export function SurfaceSwitch({ collapsed = false }: { collapsed?: boolean }) {
  const { accountKey } = useAccount();
  const { theme } = useTheme();
  const [active, setActive] = useState<Surface>('studio');
  const [studioUrl, setStudioUrl] = useState<string | null>(null);
  const [reportingUrl, setReportingUrl] = useState<string | null>(null);
  const [appUrl, setAppUrl] = useState<string | null>(null);

  useEffect(() => {
    const surface = getCurrentSurface();
    setActive(surface ?? 'studio');
    const withCtx = (url: string | null) => {
      if (!url) return null;
      let u = appendThemeParam(url, theme);
      if (accountKey) u += `&account=${encodeURIComponent(accountKey)}`;
      return u;
    };
    setStudioUrl(withCtx(getStudioUrl('/')));
    setReportingUrl(withCtx(getReportingUrl('/')));
    setAppUrl(withCtx(getAppUrl('/projects')));
  }, [theme, accountKey]);

  const items: { key: Surface; label: string; href: string | null; icon: typeof Squares2X2Icon }[] = [
    { key: 'studio', label: 'Studio', href: studioUrl, icon: Squares2X2Icon },
    { key: 'reporting', label: 'Reporting', href: reportingUrl, icon: ChartBarSquareIcon },
    { key: 'app', label: 'Projects', href: appUrl, icon: RectangleStackIcon },
  ];

  if (collapsed) {
    // Rail: the inactive surfaces as icon links, stacked (one tap to switch).
    return (
      <div className="flex flex-col items-center gap-1">
        {items
          .filter((it) => it.key !== active && it.href)
          .map((it) => (
            <SidebarTooltip key={it.key} label={`Switch to ${it.label}`}>
              <a
                href={it.href ?? '#'}
                aria-label={`Switch to ${it.label}`}
                className="flex items-center justify-center rounded-xl px-2 py-2 text-[var(--sidebar-muted-foreground)] transition hover:bg-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]"
              >
                <it.icon className="h-5 w-5" />
              </a>
            </SidebarTooltip>
          ))}
      </div>
    );
  }

  // Icon-only segments with tooltips — three text labels don't fit the sidebar
  // width, and the active segment's highlight + tooltip keep it clear.
  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-[var(--sidebar-border)] bg-[var(--sidebar-muted)]/40 p-0.5">
      {items.map((it) => {
        const isActive = it.key === active;
        const base =
          'flex flex-1 items-center justify-center rounded-lg py-1.5 text-xs font-medium transition';
        if (isActive) {
          return (
            <SidebarTooltip key={it.key} label={it.label}>
              <span
                aria-current="page"
                aria-label={it.label}
                className={`${base} gap-1.5 bg-[var(--background)] text-[var(--sidebar-foreground)] shadow-sm`}
              >
                <it.icon className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{it.label}</span>
              </span>
            </SidebarTooltip>
          );
        }
        return (
          <SidebarTooltip key={it.key} label={`Switch to ${it.label}`}>
            <a
              href={it.href ?? '#'}
              aria-label={`Switch to ${it.label}`}
              className={`${base} text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)]`}
            >
              <it.icon className="h-4 w-4 flex-shrink-0" />
            </a>
          </SidebarTooltip>
        );
      })}
    </div>
  );
}
