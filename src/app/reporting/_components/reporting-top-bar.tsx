'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  ArrowRightStartOnRectangleIcon,
  ArrowTopRightOnSquareIcon,
  BellIcon,
  BugAntIcon,
  ClockIcon,
  MoonIcon,
  QuestionMarkCircleIcon,
  SunIcon,
  Squares2X2Icon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useTheme } from '@/contexts/theme-context';
import { useAccount } from '@/contexts/account-context';
import { UserAvatar } from '@/components/user-avatar';
import { ChangelogPanel } from '@/components/changelog-panel';
import { NotificationsPanel } from '@/components/notifications-panel';
import { appendThemeParam, getOtherSurfaceUrl } from '@/lib/cross-site';
import { accountKeyToSlug, subaccountPath } from '@/lib/account-slugs';
import type { UserRole } from '@/lib/roles';

/**
 * Reporting surface utility bar. Mirrors the studio
 * `top-utility-bar.tsx` feature set (help, notifications + unread badge,
 * changelog + unread dot, bug report, user dropdown with avatar + role
 * + profile + theme + cross-link + sign out) but trimmed of the studio
 * context dependencies (`useAccount`, `useUnsavedChanges`) that aren't
 * meaningful on the client-facing reporting tree. User identity is
 * passed in as props from the server-rendered layout.
 */
function UtilityIconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
    >
      {children}
    </button>
  );
}

export function ReportingTopBar({
  userName,
  userEmail,
  userAvatarUrl,
  userRole,
}: {
  userName: string;
  userEmail: string;
  userAvatarUrl: string | null;
  userRole: UserRole;
}) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const { account, accounts } = useAccount();

  // User dropdown
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const canViewRoleBadge =
    userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';

  // Cross-site (studio) URL. When an account is active on reporting, land
  // the user on studio's /subaccount/<slug>/dashboard so studio's own
  // URL-based account routing picks up the same account on arrival.
  // Falls back to studio root for admin mode.
  const [studioUrl, setStudioUrl] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    if (account.mode === 'account' && account.accountKey) {
      const slug = accountKeyToSlug(account.accountKey, accounts);
      url = slug
        ? getOtherSurfaceUrl(subaccountPath(slug, 'dashboard'))
        : getOtherSurfaceUrl();
    } else {
      url = getOtherSurfaceUrl();
    }
    // Carry theme so studio matches reporting's current setting.
    if (url) url = appendThemeParam(url, theme);
    setStudioUrl(url);
  }, [account, accounts, theme]);

  // Notifications
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const checkUnreadNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?unreadOnly=1&limit=1');
      if (!res.ok) return;
      const data = (await res.json()) as { unreadCount: number };
      setUnreadNotifications(data.unreadCount ?? 0);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    checkUnreadNotifications();
    const id = setInterval(checkUnreadNotifications, 60_000);
    return () => clearInterval(id);
  }, [checkUnreadNotifications]);

  // Changelog
  const [showChangelog, setShowChangelog] = useState(false);
  const [hasChangelogUnread, setHasChangelogUnread] = useState(false);
  const checkChangelogUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/changelog');
      if (!res.ok) return;
      const data = await res.json();
      const entries = data.entries || [];
      if (entries.length === 0) {
        setHasChangelogUnread(false);
        return;
      }
      const latest = entries[0].publishedAt;
      const seen = localStorage.getItem('loomi-changelog-seen');
      setHasChangelogUnread(!seen || new Date(latest) > new Date(seen));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    checkChangelogUnread();
  }, [checkChangelogUnread]);

  // Close user menu on outside click + Escape
  useEffect(() => {
    if (!userMenuOpen) return;
    function handleMouseDown(event: MouseEvent) {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [userMenuOpen]);

  // Close menu on route change
  useEffect(() => {
    setUserMenuOpen(false);
  }, [pathname]);

  return (
    <>
      <header
        className="flex items-center justify-end gap-4 px-6"
        aria-label="Reporting utilities"
      >
        <UtilityIconButton
          title="Help & support"
          onClick={() => {
            window.open(
              'mailto:support@loomilm.com?subject=Reporting%20help',
              '_self',
            );
          }}
        >
          <QuestionMarkCircleIcon className="h-5 w-5" />
        </UtilityIconButton>

        <div className="relative">
          <UtilityIconButton
            title={
              unreadNotifications > 0
                ? `Notifications (${unreadNotifications} unread)`
                : 'Notifications'
            }
            onClick={() => setShowNotifications(true)}
          >
            <BellIcon className="h-5 w-5" />
          </UtilityIconButton>
          {unreadNotifications > 0 && (
            <span
              className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[9px] font-bold leading-none text-white"
              aria-hidden
            >
              {unreadNotifications > 9 ? '9+' : unreadNotifications}
            </span>
          )}
        </div>

        <div className="relative">
          <UtilityIconButton
            title="What's new"
            onClick={() => {
              setShowChangelog(true);
              setHasChangelogUnread(false);
            }}
          >
            <ClockIcon className="h-5 w-5" />
          </UtilityIconButton>
          {hasChangelogUnread && (
            <span className="pointer-events-none absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-[var(--primary)]" />
          )}
        </div>

        <UtilityIconButton
          title="Report a bug"
          onClick={() => toast.info('Bug reporting portal coming soon')}
        >
          <BugAntIcon className="h-5 w-5" />
        </UtilityIconButton>

        {/* User avatar + dropdown */}
        <div ref={userMenuRef} className="relative">
          <button
            type="button"
            title="Account"
            aria-label="Account"
            onClick={() => setUserMenuOpen((prev) => !prev)}
            className="ml-1 flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-80"
          >
            <UserAvatar
              name={userName}
              email={userEmail}
              avatarUrl={userAvatarUrl}
              size={32}
              className="h-8 w-8 rounded-full object-cover"
            />
          </button>

          {userMenuOpen && (
            <div className="glass-dropdown absolute right-0 top-full z-50 mt-2 w-64 shadow-lg">
              <div className="border-b border-[var(--border)] p-3">
                <div className="flex items-center gap-2.5">
                  <UserAvatar
                    name={userName}
                    email={userEmail}
                    avatarUrl={userAvatarUrl}
                    size={36}
                    className="h-9 w-9 flex-shrink-0 rounded-full object-cover"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">
                      {userName || 'User'}
                    </p>
                    <p className="truncate text-xs text-[var(--muted-foreground)]">
                      {userEmail || 'No email'}
                    </p>
                    {canViewRoleBadge && (
                      <span className="mt-1 inline-block rounded bg-[var(--primary)]/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--primary)]">
                        {userRole}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-1.5">
                <Link
                  href="/profile"
                  onClick={() => setUserMenuOpen(false)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                >
                  <UserCircleIcon className="h-4 w-4" />
                  Profile
                </Link>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                >
                  {theme === 'dark' ? (
                    <SunIcon className="h-4 w-4" />
                  ) : (
                    <MoonIcon className="h-4 w-4" />
                  )}
                  {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                </button>
                {studioUrl && (
                  <a
                    href={studioUrl}
                    onClick={() => setUserMenuOpen(false)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                  >
                    <Squares2X2Icon className="h-4 w-4" />
                    <span className="flex-1 text-left">Studio</span>
                    <ArrowTopRightOnSquareIcon className="h-3 w-3 text-[var(--muted-foreground)]" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                >
                  <ArrowRightStartOnRectangleIcon className="h-4 w-4" />
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {showNotifications && (
        <NotificationsPanel
          onClose={() => setShowNotifications(false)}
          onChange={() => checkUnreadNotifications()}
        />
      )}
      {showChangelog && <ChangelogPanel onClose={() => setShowChangelog(false)} />}
    </>
  );
}
