'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  ArrowRightStartOnRectangleIcon,
  ArrowTopRightOnSquareIcon,
  BellIcon,
  BugAntIcon,
  ChartBarIcon,
  ClockIcon,
  MoonIcon,
  QuestionMarkCircleIcon,
  SunIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { appendThemeParam, getOtherSurfaceUrl } from '@/lib/cross-site';
import { useAccount } from '@/contexts/account-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import { useTheme } from '@/contexts/theme-context';
import { UserAvatar } from '@/components/user-avatar';
import { AI_ASSIST_OPEN_EVENT } from '@/lib/ui-events';
import { ChangelogPanel } from '@/components/changelog-panel';
import { NotificationsPanel } from '@/components/notifications-panel';

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
      className="inline-flex items-center justify-center w-8 h-8 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
    >
      {children}
    </button>
  );
}

export function TopUtilityBar() {
  const pathname = usePathname();
  const { userName, userTitle, userEmail, userAvatarUrl, userRole, account } = useAccount();
  const { confirmNavigation } = useUnsavedChanges();
  const { theme, toggleTheme } = useTheme();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userSecondaryLabel = userTitle || userEmail || 'No email';
  const canViewRoleBadges =
    userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';

  // Changelog
  const [showChangelog, setShowChangelog] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);

  const checkUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/changelog');
      if (!res.ok) return;
      const data = await res.json();
      const entries = data.entries || [];
      if (entries.length === 0) { setHasUnread(false); return; }
      const latest = entries[0].publishedAt;
      const seen = localStorage.getItem('loomi-changelog-seen');
      setHasUnread(!seen || new Date(latest) > new Date(seen));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { checkUnread(); }, [checkUnread]);

  // Notifications
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const checkUnreadNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?unreadOnly=1&limit=1');
      if (!res.ok) return;
      const data = (await res.json()) as { unreadCount: number };
      setUnreadNotifications(data.unreadCount ?? 0);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    checkUnreadNotifications();
    const id = setInterval(checkUnreadNotifications, 60_000);
    return () => clearInterval(id);
  }, [checkUnreadNotifications]);

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

  useEffect(() => {
    setUserMenuOpen(false);
  }, [pathname]);

  return (
    <header className="flex justify-end mb-6" aria-label="Page utilities">
      <div className="flex items-center gap-2">
        <UtilityIconButton
          title="Help"
          onClick={() => {
            window.dispatchEvent(new Event(AI_ASSIST_OPEN_EVENT));
          }}
        >
          <QuestionMarkCircleIcon className="w-5 h-5" />
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
            <BellIcon className="w-5 h-5" />
          </UtilityIconButton>
          {unreadNotifications > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold leading-none px-1 rounded-full bg-[var(--primary)] text-white pointer-events-none"
              aria-hidden
            >
              {unreadNotifications > 9 ? '9+' : unreadNotifications}
            </span>
          )}
        </div>

        <div className="relative">
          <UtilityIconButton
            title="Changelog"
            onClick={() => { setShowChangelog(true); setHasUnread(false); }}
          >
            <ClockIcon className="w-5 h-5" />
          </UtilityIconButton>
          {hasUnread && (
            <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-[var(--primary)] rounded-full pointer-events-none" />
          )}
        </div>

        <UtilityIconButton
          title="Report a Bug"
          onClick={() => toast.info('Bug reporting portal coming soon')}
        >
          <BugAntIcon className="w-5 h-5" />
        </UtilityIconButton>

        <div ref={userMenuRef} className="relative">
          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-2 z-50 w-64 glass-dropdown shadow-lg">
              <div className="p-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2.5">
                  <UserAvatar
                    name={userName}
                    email={userEmail}
                    avatarUrl={userAvatarUrl}
                    size={36}
                    className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--foreground)] truncate">
                      {userName || 'User'}
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)] truncate">
                      {userSecondaryLabel}
                    </p>
                    {userRole && canViewRoleBadges && (
                      <span className="inline-block mt-1 text-[10px] font-medium uppercase tracking-wider text-[var(--primary)] bg-[var(--primary)]/10 rounded px-1.5 py-0.5">
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
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <UserCircleIcon className="w-4 h-4" />
                  Profile
                </Link>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  {theme === 'dark' ? (
                    <SunIcon className="w-4 h-4" />
                  ) : (
                    <MoonIcon className="w-4 h-4" />
                  )}
                  {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                </button>
                {(() => {
                  let otherUrl = getOtherSurfaceUrl();
                  if (!otherUrl) return null;
                  // Pass the active account + theme through the URL so
                  // reporting can restore the same context on arrival.
                  if (account.mode === 'account' && account.accountKey) {
                    const sep = otherUrl.includes('?') ? '&' : '?';
                    otherUrl = `${otherUrl}${sep}account=${encodeURIComponent(account.accountKey)}`;
                  }
                  otherUrl = appendThemeParam(otherUrl, theme);
                  return (
                    <a
                      href={otherUrl}
                      onClick={() => setUserMenuOpen(false)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                    >
                      <ChartBarIcon className="w-4 h-4" />
                      <span className="flex-1 text-left">Reporting</span>
                      <ArrowTopRightOnSquareIcon className="w-3 h-3 text-[var(--muted-foreground)]" />
                    </a>
                  );
                })()}
                <button
                  type="button"
                  onClick={() => {
                    confirmNavigation(() => signOut({ callbackUrl: '/login' }), '/login');
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
                  Logout
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            title="Account"
            aria-label="Account"
            onClick={() => setUserMenuOpen((prev) => !prev)}
            className="inline-flex items-center justify-center w-8 h-8 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <UserAvatar
              name={userName}
              email={userEmail}
              avatarUrl={userAvatarUrl}
              size={32}
              className="w-8 h-8 rounded-full object-cover flex-shrink-0"
            />
          </button>
        </div>
      </div>

      {showChangelog && (
        <ChangelogPanel onClose={() => { setShowChangelog(false); checkUnread(); }} />
      )}
      {showNotifications && (
        <NotificationsPanel
          onClose={() => {
            setShowNotifications(false);
            checkUnreadNotifications();
          }}
          onChange={(unread) => setUnreadNotifications(unread)}
        />
      )}
    </header>
  );
}
