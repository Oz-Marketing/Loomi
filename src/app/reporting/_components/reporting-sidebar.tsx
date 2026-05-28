'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';
import {
  HomeIcon,
  EnvelopeIcon,
  UsersIcon,
  ChartBarIcon,
  ArrowTopRightOnSquareIcon,
  Squares2X2Icon,
  ArrowRightStartOnRectangleIcon,
} from '@heroicons/react/24/outline';
import { getOtherSurfaceUrl } from '@/lib/cross-site';

/**
 * Reporting nav items. Hrefs are the BROWSER-facing paths on
 * `reporting.loomilm.com` — middleware rewrites `/campaigns` →
 * `/reporting/campaigns` etc. before route matching, but `usePathname()`
 * in client components returns the browser URL, so active-state
 * comparison uses the un-rewritten path.
 */
type NavItem = {
  href: string;
  label: string;
  icon: typeof HomeIcon;
  /** When true, only the exact pathname matches (used for root `/`); otherwise a
   *  `startsWith` match treats sub-routes as active. */
  matchExact?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: HomeIcon, matchExact: true },
  { href: '/campaigns', label: 'Campaigns', icon: EnvelopeIcon },
  { href: '/contacts', label: 'Contacts', icon: UsersIcon },
  { href: '/engagement', label: 'Engagement', icon: ChartBarIcon },
];

export function ReportingSidebar({
  name,
  email,
  avatarUrl,
}: {
  name: string;
  email: string;
  avatarUrl: string | null;
}) {
  const pathname = usePathname();
  const [studioUrl, setStudioUrl] = useState<string | null>(null);

  useEffect(() => {
    setStudioUrl(getOtherSurfaceUrl());
  }, []);

  return (
    <aside className="glass-panel fixed left-3 top-3 bottom-3 w-60 rounded-2xl text-[var(--sidebar-foreground)] flex flex-col z-50">
      {/* Branding */}
      <div className="p-5 pb-4 border-b border-[var(--sidebar-border)]">
        <Link href="/" className="block">
          <div className="text-base font-semibold tracking-tight">
            loomi <span className="text-[var(--primary)]">reporting</span>
          </div>
        </Link>
      </div>

      {/* Top-level nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = item.matchExact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-[var(--primary)] text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)]'
                  : 'text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)]'
              }`}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Cross-link to Studio */}
      {studioUrl && (
        <div className="px-3">
          <a
            href={studioUrl}
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)] transition-colors"
          >
            <Squares2X2Icon className="w-4 h-4" />
            <span className="flex-1 text-left">Open Studio</span>
            <ArrowTopRightOnSquareIcon className="w-3 h-3 opacity-70" />
          </a>
        </div>
      )}

      {/* User + sign out */}
      <div className="p-3 border-t border-[var(--sidebar-border)] mt-2">
        <div className="flex items-center gap-3 px-2 py-2">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={name}
              className="h-8 w-8 rounded-full border border-[var(--border)] object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--muted)] text-xs font-semibold">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-[var(--sidebar-foreground)]">
              {name}
            </div>
            <div className="truncate text-[10px] text-[var(--sidebar-muted-foreground)]">
              {email}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="mt-1 w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium text-[var(--sidebar-muted-foreground)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
