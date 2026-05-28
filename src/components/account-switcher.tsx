'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import {
  ArrowLeftIcon,
  ChevronUpDownIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { useAccount, type AccountData } from '@/contexts/account-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import { AccountAvatar } from '@/components/account-avatar';
import { SidebarTooltip } from '@/components/sidebar-collapsed-ui';
import { getCurrentSurface } from '@/lib/cross-site';
import { formatAccountCityState, resolveAccountCity, resolveAccountState } from '@/lib/account-resolvers';
import {
  accountKeyToSlug,
  subaccountPath,
  stripSubaccountPrefix,
} from '@/lib/account-slugs';

interface AccountSwitcherProps {
  onSwitch?: () => void;
  /** When true, render only the current account's avatar as the trigger
   *  and position the dropdown to the right (used by the collapsed sidebar). */
  compact?: boolean;
}

const RECENT_SUBACCOUNT_STORAGE_KEY_PREFIX = 'loomi-recent-subaccounts';
const MAX_RECENT_SUBACCOUNTS = 3;
const SHARED_ACCOUNT_ROUTE_ROOTS = new Set([
  'dashboard',
  'contacts',
  'templates',
  'media',
  'campaigns',
  'flows',
]);

// Routes that work in both admin and account modes via context, NOT URL prefix.
// Switching accounts should keep these paths unchanged — only the account
// context updates. Used for admin-only tools that don't have a subaccount-
// scoped route variant.
const CONTEXT_SCOPED_ROUTE_ROOTS = new Set(['tools']);

const ADMIN_SETTINGS_TO_SUBACCOUNT_TAB: Record<string, string> = {
  subaccounts: 'company',
  subaccount: 'company',
  users: 'users',
  integrations: 'integration',
  integration: 'integration',
  'custom-values': 'custom-values',
  appearance: 'appearance',
};

const SUBACCOUNT_SETTINGS_TO_ADMIN_PATH: Record<string, string> = {
  company: '/settings/subaccounts',
  branding: '/settings/subaccounts',
  users: '/settings/users',
  integration: '/settings/integrations',
  integrations: '/settings/integrations',
  'custom-values': '/settings/custom-values',
  appearance: '/settings/appearance',
};

interface RecentSubaccountEntry {
  key: string;
  lastViewedAt: number;
}

function getRecentSubaccountsStorageKey(userEmail: string | null): string | null {
  const normalizedEmail = userEmail?.trim().toLowerCase();
  if (!normalizedEmail) return null;
  return `${RECENT_SUBACCOUNT_STORAGE_KEY_PREFIX}:${normalizedEmail}`;
}

function readRecentSubaccounts(storageKey: string | null): RecentSubaccountEntry[] {
  if (typeof window === 'undefined' || !storageKey) return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .flatMap((entry) => {
        if (!entry || typeof entry.key !== 'string') return [];
        return [{
          key: entry.key,
          lastViewedAt: typeof entry.lastViewedAt === 'number' ? entry.lastViewedAt : 0,
        }];
      })
      .sort((a, b) => b.lastViewedAt - a.lastViewedAt)
      .slice(0, MAX_RECENT_SUBACCOUNTS);
  } catch {
    return [];
  }
}

function recordRecentSubaccount(storageKey: string, accountKey: string): RecentSubaccountEntry[] {
  const nextEntries = [
    { key: accountKey, lastViewedAt: Date.now() },
    ...readRecentSubaccounts(storageKey).filter((entry) => entry.key !== accountKey),
  ].slice(0, MAX_RECENT_SUBACCOUNTS);

  window.localStorage.setItem(storageKey, JSON.stringify(nextEntries));
  return nextEntries;
}

function resolveAdminPath(pathname: string): string {
  const strippedPath = stripSubaccountPrefix(pathname);
  const segments = strippedPath.split('/').filter(Boolean);

  if (segments.length === 0 || segments[0] === 'dashboard') {
    return '/dashboard';
  }

  if (
    SHARED_ACCOUNT_ROUTE_ROOTS.has(segments[0]) ||
    CONTEXT_SCOPED_ROUTE_ROOTS.has(segments[0])
  ) {
    return `/${segments.join('/')}`;
  }

  if (segments[0] === 'settings') {
    return SUBACCOUNT_SETTINGS_TO_ADMIN_PATH[segments[1] || ''] || '/settings/subaccounts';
  }

  return '/dashboard';
}

function resolveSubaccountPath(pathname: string, slug: string): string {
  const strippedPath = stripSubaccountPrefix(pathname);
  const segments = strippedPath.split('/').filter(Boolean);

  if (segments.length === 0 || segments[0] === 'dashboard') {
    return subaccountPath(slug, 'dashboard');
  }

  // Context-scoped routes (admin-only tools) keep their path as-is — only
  // the account context updates so the page re-fetches for the new account.
  if (CONTEXT_SCOPED_ROUTE_ROOTS.has(segments[0])) {
    return `/${segments.join('/')}`;
  }

  if (SHARED_ACCOUNT_ROUTE_ROOTS.has(segments[0])) {
    return `/subaccount/${slug}/${segments.join('/')}`;
  }

  if (segments[0] === 'settings') {
    const tab = ADMIN_SETTINGS_TO_SUBACCOUNT_TAB[segments[1] || ''] || 'company';
    return `/subaccount/${slug}/settings/${tab}`;
  }

  if (segments[0] === 'users') {
    return `/subaccount/${slug}/settings/users`;
  }

  if (segments[0] === 'subaccounts') {
    return `/subaccount/${slug}/settings/company`;
  }

  return subaccountPath(slug, 'dashboard');
}


function resolveAccountCityStateLabel(accountData: AccountData): string | null {
  return formatAccountCityState(accountData) || null;
}

export function AccountSwitcher({ onSwitch, compact = false }: AccountSwitcherProps) {
  const { account, setAccount, accounts, accountsLoaded, userRole, userEmail } = useAccount();
  const { confirmNavigation } = useUnsavedChanges();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [recentAccountKeys, setRecentAccountKeys] = useState<string[]>([]);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const canSwitchToAdmin = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';
  const isAdmin = account.mode === 'admin';
  const currentKey = account.mode === 'account' ? account.accountKey : null;
  const currentAccount = currentKey ? accounts[currentKey] : null;
  const recentStorageKey = getRecentSubaccountsStorageKey(userEmail);

  // Position dropdown when opening. In compact mode (collapsed sidebar)
  // the dropdown flies out to the RIGHT of the trigger so it doesn't
  // get clipped by the narrow rail.
  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      if (compact) {
        setPos({
          top: rect.top,
          left: rect.right + 12,
        });
      } else {
        setPos({
          top: rect.bottom + 6,
          left: rect.left,
        });
      }
    }
  }, [open, compact]);

  // Close on outside click (checks both trigger and portal dropdown)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const clickedTrigger = triggerRef.current?.contains(target);
      const clickedDropdown = dropdownRef.current?.contains(target);
      if (!clickedTrigger && !clickedDropdown) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search when opened
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setSearch(''); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    if (!recentStorageKey) {
      setRecentAccountKeys([]);
      return;
    }

    const syncRecentAccounts = () => {
      setRecentAccountKeys(readRecentSubaccounts(recentStorageKey).map((entry) => entry.key));
    };

    syncRecentAccounts();
    window.addEventListener('storage', syncRecentAccounts);
    return () => window.removeEventListener('storage', syncRecentAccounts);
  }, [recentStorageKey]);

  useEffect(() => {
    if (!currentKey || !recentStorageKey) return;
    const nextEntries = recordRecentSubaccount(recentStorageKey, currentKey);
    setRecentAccountKeys(nextEntries.map((entry) => entry.key));
  }, [currentKey, recentStorageKey]);

  const handleSelect = (key: string | '__admin__') => {
    const destinationLabel = key === '__admin__' ? 'Admin Account' : (accounts[key]?.dealer || key);
    confirmNavigation(() => {
      // Reporting surface routes don't use the studio `/subaccount/<slug>/*`
      // URL structure — pages read the active account from context and
      // filter their data accordingly. So on reporting we update context
      // and skip URL navigation (which would land on a 404 if we pushed
      // a /subaccount/... path that the reporting tree doesn't have).
      const onReporting = getCurrentSurface() === 'reporting';

      if (key === '__admin__') {
        setAccount({ mode: 'admin' });
        if (!onReporting) router.push(resolveAdminPath(pathname));
      } else {
        if (onReporting) {
          setAccount({ mode: 'account', accountKey: key });
        } else {
          const slug = accountKeyToSlug(key, accounts);
          const targetPath = slug ? resolveSubaccountPath(pathname, slug) : null;
          // Context-scoped routes (e.g. /tools/*) keep the same path on switch
          // — the layout doesn't pick up the slug from the URL, so we have to
          // update the account context ourselves.
          const stayingOnSamePath = targetPath === pathname;
          if (stayingOnSamePath || !slug) {
            setAccount({ mode: 'account', accountKey: key });
          } else if (targetPath) {
            router.push(targetPath);
          }
        }
      }
      setOpen(false);
      setSearch('');
      onSwitch?.();
    }, destinationLabel);
  };

  const filteredAccounts = Object.entries(accounts).filter(([key, accountData]) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const cityStateLabel = resolveAccountCityStateLabel(accountData)?.toLowerCase() || '';
    return (
      (accountData.dealer || '').toLowerCase().includes(q) ||
      key.toLowerCase().includes(q) ||
      resolveAccountCity(accountData).toLowerCase().includes(q) ||
      resolveAccountState(accountData).toLowerCase().includes(q) ||
      cityStateLabel.includes(q)
    );
  });
  const recentAccounts = !search
    ? recentAccountKeys
      .map((key) => {
        const accountData = accounts[key];
        return accountData ? ([key, accountData] as const) : null;
      })
      .filter((entry): entry is readonly [string, AccountData] => Boolean(entry))
    : [];

  const getAccountAddress = (accountData: AccountData) => resolveAccountCityStateLabel(accountData);
  const renderAccountOption = (key: string, accountData: AccountData, itemKey: string = key) => {
    const selected = currentKey === key;

    return (
      <button
        key={itemKey}
        onClick={() => handleSelect(key)}
        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
          selected ? 'bg-[var(--primary)]/10' : 'hover:bg-[var(--muted)]'
        }`}
      >
        <AccountSwitcherAvatar account={accountData} accountKey={key} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[var(--foreground)] truncate">
            {accountData.dealer || key}
          </p>
          {getAccountAddress(accountData) && (
            <p className="text-[10px] text-[var(--muted-foreground)] truncate leading-tight">
              {getAccountAddress(accountData)}
            </p>
          )}
        </div>
        {selected && <CheckIcon className="w-3.5 h-3.5 text-[var(--primary)] flex-shrink-0" />}
      </button>
    );
  };

  // Client-role users see a static display with no dropdown.
  if (userRole === 'client') {
    if (compact) {
      // Compact client view: just the avatar, centered, no dropdown.
      const label = currentAccount?.dealer || currentKey || 'Your Sub-Account';
      return (
        <SidebarTooltip label={label}>
          <div className="flex items-center justify-center w-full" aria-label={label}>
            {currentAccount ? (
              <AccountSwitcherAvatar account={currentAccount} accountKey={currentKey} />
            ) : (
              <div className="w-7 h-7 rounded-md bg-[var(--sidebar-muted)] flex-shrink-0" />
            )}
          </div>
        </SidebarTooltip>
      );
    }
    return (
      <div className="w-full flex items-center gap-2.5">
        {currentAccount ? (
          <AccountSwitcherAvatar account={currentAccount} accountKey={currentKey} />
        ) : (
          <div className="w-7 h-7 rounded-md bg-[var(--sidebar-muted)] flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[var(--sidebar-foreground)] truncate">
            {currentAccount?.dealer || currentKey || 'Your Sub-Account'}
          </p>
          {currentAccount && getAccountAddress(currentAccount) && (
            <p className="text-[10px] text-[var(--sidebar-muted-foreground)] truncate leading-tight">
              {getAccountAddress(currentAccount)}
            </p>
          )}
        </div>
      </div>
    );
  }

  const triggerAvatar = isAdmin ? (
    <div className="w-7 h-7 rounded-md bg-[var(--primary)]/15 flex items-center justify-center flex-shrink-0">
      <ShieldCheckIcon className="w-3.5 h-3.5 text-[var(--primary)]" />
    </div>
  ) : currentAccount ? (
    <AccountSwitcherAvatar account={currentAccount} accountKey={currentKey} />
  ) : (
    <div className="w-7 h-7 rounded-md bg-[var(--sidebar-muted)] flex-shrink-0" />
  );
  const triggerLabel = isAdmin
    ? 'Admin Account'
    : currentAccount?.dealer || currentKey || 'Select sub-account';

  return (
    <>
      {/* Trigger — compact mode = avatar only (collapsed sidebar);
          expanded = full pill with label + chevron. */}
      {compact ? (
        <SidebarTooltip label={triggerLabel}>
          <button
            ref={triggerRef}
            onClick={() => setOpen(!open)}
            aria-label={triggerLabel}
            aria-haspopup="menu"
            aria-expanded={open}
            className="w-full flex items-center justify-center p-1 rounded-xl hover:bg-[var(--sidebar-muted)] transition-colors"
          >
            {triggerAvatar}
          </button>
        </SidebarTooltip>
      ) : (
        <button
          ref={triggerRef}
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl border border-[var(--sidebar-border)] bg-[var(--sidebar-input)] hover:bg-[var(--sidebar-muted)] transition-colors text-left"
        >
          {triggerAvatar}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[var(--sidebar-foreground)] truncate">
              {triggerLabel}
            </p>
            {!isAdmin && currentAccount && (
              <p className="text-[10px] text-[var(--sidebar-muted-foreground)] truncate leading-tight">
                {getAccountAddress(currentAccount)}
              </p>
            )}
          </div>
          <ChevronUpDownIcon className="w-3.5 h-3.5 text-[var(--sidebar-muted-foreground)] flex-shrink-0" />
        </button>
      )}

      {/* Portal dropdown */}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[200] w-72 rounded-xl glass-dropdown overflow-hidden animate-fade-in-up"
          style={{ top: pos.top, left: pos.left }}
        >
          {/* Search */}
          <div className="p-1.5 border-b border-[var(--border)]">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search sub-accounts..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>

          {/* Admin option */}
          {canSwitchToAdmin && !isAdmin && !search && (
            <div className="px-3 py-2 border-b border-[var(--border)]">
              <button
                onClick={() => handleSelect('__admin__')}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--primary)] hover:opacity-80 transition-opacity"
              >
                <ArrowLeftIcon className="w-3.5 h-3.5" />
                Back to Admin Account
              </button>
            </div>
          )}

          {!search && recentAccounts.length > 0 && (
            <div className="p-1 border-b border-[var(--border)]">
              <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Recently viewed
              </p>
              {recentAccounts.map(([key, accountData]) => renderAccountOption(key, accountData, `recent-${key}`))}
            </div>
          )}

          {/* Account list */}
          <div className="max-h-[320px] overflow-y-auto p-1">
            {!accountsLoaded ? (
              <p className="text-xs text-[var(--muted-foreground)] text-center py-4">Loading...</p>
            ) : filteredAccounts.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)] text-center py-4">
                {search ? 'No sub-accounts match your search' : 'No sub-accounts available'}
              </p>
            ) : (
              filteredAccounts.map(([key, accountData]) => renderAccountOption(key, accountData))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function AccountSwitcherAvatar({ account, accountKey }: { account: AccountData; accountKey: string | null }) {
  return (
    <AccountAvatar
      name={account.dealer}
      accountKey={accountKey || account.dealer}
      storefrontImage={account.storefrontImage}
      logos={account.logos}
      size={28}
      className="w-7 h-7 rounded-md object-cover flex-shrink-0 border border-[var(--border)]"
    />
  );
}
