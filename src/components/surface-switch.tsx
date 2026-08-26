'use client';

import { useEffect, useState, type ReactElement, type SVGProps } from 'react';
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
import { SECTOR_ICONS } from '@/components/icons/sector-icons';

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

  // The marks are the per-surface `sector-icons` glyphs rather than Heroicons
  // outlines: each surface owns a fixed colour, so the switch is legible by
  // colour alone before you read a label. They deliberately do not follow
  // `--primary` — see the note in sector-icons.tsx.
  const items: {
    key: Surface;
    label: string;
    href: string | null;
    icon: (props: SVGProps<SVGSVGElement>) => ReactElement;
  }[] = [
    { key: 'studio', label: 'Studio', href: studioUrl, icon: SECTOR_ICONS.studio },
    { key: 'reporting', label: 'Reporting', href: reportingUrl, icon: SECTOR_ICONS.reporting },
    { key: 'app', label: 'Projects', href: appUrl, icon: SECTOR_ICONS.app },
  ];

  if (collapsed) {
    // Rail: the inactive surfaces as icon links, stacked (one tap to switch).
    return (
      <div className="surface-switch-rail">
        {items
          .filter((it) => it.key !== active && it.href)
          .map((it) => (
            <SidebarTooltip
              key={it.key}
              label={`Switch to ${it.label}`}
              className="surface-switch-slot"
            >
              <a
                href={it.href ?? '#'}
                aria-label={`Switch to ${it.label}`}
                className="surface-switch-rail-item"
              >
                <it.icon className="h-[1.375rem] w-[1.375rem]" />
              </a>
            </SidebarTooltip>
          ))}
      </div>
    );
  }

  // Only the active segment carries its label — three text labels don't fit the
  // sidebar width. The inactive two collapse to icons, with tooltips naming the
  // surface they'd take you to. Styling lives in `.surface-switch*`
  // (globals.css) so the gradient pill + recessed track stay in one place.
  return (
    <div className="surface-switch">
      {items.map((it) => {
        const isActive = it.key === active;
        if (isActive) {
          return (
            <SidebarTooltip
              key={it.key}
              label={it.label}
              className="surface-switch-slot surface-switch-slot-active"
            >
              <span
                aria-current="page"
                aria-label={it.label}
                className="surface-switch-seg surface-switch-seg-active"
              >
                <it.icon className="h-[1.125rem] w-[1.125rem] flex-shrink-0" />
                <span className="truncate">{it.label}</span>
              </span>
            </SidebarTooltip>
          );
        }
        return (
          <SidebarTooltip
            key={it.key}
            label={`Switch to ${it.label}`}
            className="surface-switch-slot"
          >
            <a
              href={it.href ?? '#'}
              aria-label={`Switch to ${it.label}`}
              className="surface-switch-seg"
            >
              <it.icon className="h-[1.125rem] w-[1.125rem] flex-shrink-0" />
            </a>
          </SidebarTooltip>
        );
      })}
    </div>
  );
}
