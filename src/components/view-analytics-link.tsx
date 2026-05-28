'use client';

import { useEffect, useState } from 'react';
import { ArrowTopRightOnSquareIcon, ChartBarSquareIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { appendThemeParam, getOtherSurfaceUrl } from '@/lib/cross-site';

/**
 * "View Analytics →" affordance shown on studio creative pages
 * (Messaging, Flows, Websites, Ads). Cross-links to the matching
 * reporting page, preserving the active account via `?account=<key>`
 * so reporting lands on the same context.
 *
 * Renders as a small pill-style link that fits in page headers next
 * to other actions. Returns `null` until hydration so the URL is
 * resolved against `window.location.host`.
 */
export function ViewAnalyticsLink({
  area,
  label = 'View Analytics',
}: {
  /** Reporting subroute to land on (e.g. `engagement`, `contacts`, `websites`, `ads`). */
  area: 'contacts' | 'engagement' | 'websites' | 'ads';
  label?: string;
}) {
  const { account } = useAccount();
  const { theme } = useTheme();
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    let url = getOtherSurfaceUrl(`/${area}`);
    if (!url) return;
    if (account.mode === 'account' && account.accountKey) {
      url += `?account=${encodeURIComponent(account.accountKey)}`;
    }
    // Theme handoff — cookies don't span subdomains in dev, so the URL
    // param carries the user's current theme to the destination. The
    // destination's ThemeProvider consumes + strips it on mount.
    url = appendThemeParam(url, theme);
    setHref(url);
  }, [area, account, theme]);

  if (!href) return null;

  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:border-[var(--primary)]/50 hover:bg-[var(--accent)]"
    >
      <ChartBarSquareIcon className="h-4 w-4" />
      {label}
      <ArrowTopRightOnSquareIcon className="h-3 w-3 text-[var(--muted-foreground)]" />
    </a>
  );
}
