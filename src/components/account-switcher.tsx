'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import {
  ChevronRightIcon,
  ChevronUpDownIcon,
  BuildingStorefrontIcon,
  MagnifyingGlassIcon,
  CheckIcon,
  CogIcon,
} from '@heroicons/react/24/outline';
import {
  allAccountsSurface,
  useAccount,
  type AccountData,
} from '@/contexts/account-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import { AccountAvatar } from '@/components/account-avatar';
import { SidebarTooltip } from '@/components/sidebar-collapsed-ui';
import { getCurrentSurface } from '@/lib/cross-site';
import { formatAccountCityState, resolveAccountCity, resolveAccountState } from '@/lib/account-resolvers';
import {
  accountKeyToSlug,
  subaccountPath,
  stripScopePrefix,
} from '@/lib/account-slugs';

interface AccountSwitcherProps {
  onSwitch?: () => void;
  /** When true, render only the current account's avatar as the trigger
   *  and position the dropdown to the right (used by the collapsed sidebar). */
  compact?: boolean;
  /** Open the dropdown upward (for triggers pinned to the bottom of the rail). */
  openUp?: boolean;
  /** When set, render a Settings link at the bottom of the dropdown. */
  settingsHref?: string;
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
const CONTEXT_SCOPED_ROUTE_ROOTS = new Set(['tools', 'ad-generator']);

const ADMIN_SETTINGS_TO_SUBACCOUNT_TAB: Record<string, string> = {
  subaccounts: 'company',
  subaccount: 'company',
  users: 'users',
  integrations: 'integration',
  integration: 'integration',
  'custom-values': 'custom-values',
  appearance: 'appearance',
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

function resolveSubaccountPath(pathname: string, slug: string): string {
  const strippedPath = stripScopePrefix(pathname);
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

  // Default: stay on the current page (treat unknown roots as context-scoped) so
  // switching accounts never bounces to the dashboard. The path is unchanged and
  // the page re-reads the active account from context.
  return `/${segments.join('/')}`;
}


function resolveAccountCityStateLabel(accountData: AccountData): string | null {
  return formatAccountCityState(accountData) || null;
}

export function AccountSwitcher({ onSwitch, compact = false, openUp = false, settingsHref }: AccountSwitcherProps) {
  const {
    account,
    setAccount,
    accounts,
    accountsLoaded,
    childCounts,
    userRole,
    userEmail,
  } = useAccount();
  const { confirmNavigation } = useUnsavedChanges();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [recentAccountKeys, setRecentAccountKeys] = useState<string[]>([]);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Agency scope was once a selectable entry here ("Agency Settings"). It isn't
  // a place any more — platform config is the cog's modal. What IS still a
  // place is the all-accounts overview: the cross-account roll-up the pacer and
  // the reporting views render when nothing is selected. It went missing when
  // agency scope was retired, because that entry was the only door to it.
  //
  // Offered per SURFACE (Projects, Reporting) and per PAGE (Playbooks) — see
  // ALL_ACCOUNTS_SURFACES / ALL_ACCOUNTS_PATHS, and docs/account-scope.md for
  // the rule deciding which pages qualify. Re-read on every navigation, so the
  // option appears and disappears as you move between pages that can and can't
  // aggregate.
  const [offersAllAccounts, setOffersAllAccounts] = useState(false);
  useEffect(() => setOffersAllAccounts(allAccountsSurface()), [pathname]);
  const inAllAccounts = account.mode === 'all';
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
        // Collapsed rail: fly out to the RIGHT of the trigger, anchored to its
        // top so the menu opens downward (the trigger sits near the top of the
        // rail now).
        setPos({
          top: rect.top,
          left: rect.right + 12,
        });
      } else if (openUp) {
        setPos({ bottom: window.innerHeight - rect.top + 6, left: rect.left });
      } else {
        setPos({
          top: rect.bottom + 6,
          left: rect.left,
        });
      }
    }
  }, [open, compact, openUp]);

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

  // Focus search when opened.
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

  const handleSelect = (key: string) => {
    const destinationLabel = accounts[key]?.dealer || key;
    confirmNavigation(() => {
      // The reporting AND app surfaces don't use the studio `/subaccount/<slug>/*`
      // URL structure — their pages read the active account from context/cookie
      // and filter their data accordingly. So there we update context and skip
      // URL navigation (which would 404), then refresh() so any server-rendered
      // page (e.g. App's Initiatives list) re-reads the new active-account cookie.
      const surface = getCurrentSurface();
      const contextOnly = surface === 'reporting' || surface === 'app';

      if (contextOnly) {
        setAccount({ mode: 'account', accountKey: key });
        router.refresh();
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
      setOpen(false);
      setSearch('');
      onSwitch?.();
    }, destinationLabel);
  };


  // Historically the list was narrowed to the active org so you never saw a
  // mixed pool. With groups modelled as accounts, the group and its rooftops
  // are all selectable peers, so narrowing would hide the very accounts you
  // switch between. Kept as a no-op rather than removed, so the call sites and
  // the (still-used) activeOrg label logic stay intact during the transition.
  const inActiveOrg = (_accountData: AccountData) => true;

  const filteredAccounts = Object.entries(accounts).filter(([key, accountData]) => {
    if (!inActiveOrg(accountData)) return false;
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
  // Recently viewed is hidden while searching (the filtered list below covers
  // it) and is scoped to the active org so it doesn't surface other orgs'
  // sub-accounts.
  const recentAccounts = recentAccountKeys
    .map((key) => {
      const accountData = accounts[key];
      return accountData ? ([key, accountData] as const) : null;
    })
    .filter((entry): entry is readonly [string, AccountData] => Boolean(entry))
    .filter(([, accountData]) => inActiveOrg(accountData));

  /**
   * The hierarchy the flat list was throwing away. `parentAccountKey` already
   * records that twenty rooftops belong to Young Automotive Group while PJ Corp
   * and Burton Family Law belong to nobody — rendering that as one flat array
   * buried the unrelated clients among the rooftops.
   *
   * ORPHANS RENDER AT TOP LEVEL. A user scoped to a single rooftop can see the
   * child without seeing its parent, so "has a parentAccountKey" is not the same
   * as "its parent is in this list" — keying off the former alone would drop
   * those accounts out of the switcher entirely.
   */
  const { roots, childrenOf } = useMemo<{
    roots: [string, AccountData][];
    childrenOf: Record<string, [string, AccountData][]>;
  }>(() => {
    const childrenOf: Record<string, [string, AccountData][]> = {};
    const roots: [string, AccountData][] = [];
    const byName = (a: [string, AccountData], b: [string, AccountData]) =>
      (a[1].dealer || a[0]).localeCompare(b[1].dealer || b[0]);
    for (const entry of Object.entries(accounts)) {
      const parent = entry[1].parentAccountKey;
      if (parent && accounts[parent]) (childrenOf[parent] ??= []).push(entry);
      else roots.push(entry);
    }
    roots.sort(byName);
    for (const list of Object.values(childrenOf)) list.sort(byName);
    return { roots, childrenOf };
  }, [accounts]);

  // Which groups are open. A group starts closed unless the active account is
  // inside it — landing on Young Chevrolet with its group collapsed would leave
  // the switcher showing no trace of what is selected.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  useEffect(() => {
    const parent = currentKey ? accounts[currentKey]?.parentAccountKey : null;
    if (parent) setExpandedGroups((prev) => (prev.has(parent) ? prev : new Set(prev).add(parent)));
  }, [currentKey, accounts]);

  const getAccountAddress = (accountData: AccountData) => resolveAccountCityStateLabel(accountData);
  const renderAccountOption = (
    key: string,
    accountData: AccountData,
    itemKey: string = key,
    opts: { nested?: boolean; expandable?: boolean } = {},
  ) => {
    const selected = currentKey === key;
    const kids = childrenOf[key] ?? [];
    const expanded = expandedGroups.has(key);

    return (
      <div
        key={itemKey}
        className={`space-y-0.5 ${opts.nested ? 'ml-3 border-l border-[var(--border)] pl-2' : ''}`}
      >
      <div className="flex items-center">
      <button
        onClick={() => handleSelect(key)}
        className={`flex-1 min-w-0 flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-left transition-colors ${
          selected ? 'bg-[var(--primary)]/10' : 'hover:bg-[var(--muted)]'
        }`}
      >
        <AccountSwitcherAvatar
          account={accountData}
          accountKey={key}
          isGroup={childCounts[key] > 0}
        />
        <div className="flex-1 min-w-0">
          <p className="truncate text-xs font-medium text-[var(--foreground)]">
            {accountData.dealer || key}
          </p>
          {childCounts[key] > 0 ? (
            <p className="text-[10px] text-[var(--muted-foreground)] truncate leading-tight">
              {childCounts[key]} account{childCounts[key] === 1 ? '' : 's'}
              {getAccountAddress(accountData) ? ` · ${getAccountAddress(accountData)}` : ''}
            </p>
          ) : (
            getAccountAddress(accountData) && (
              <p className="text-[10px] text-[var(--muted-foreground)] truncate leading-tight">
                {getAccountAddress(accountData)}
              </p>
            )
          )}
        </div>
        {selected && <CheckIcon className="w-3.5 h-3.5 text-[var(--primary)] flex-shrink-0" />}
      </button>
      {/* The disclosure is its OWN control, not part of the row: opening a group
          to look at its rooftops must not switch you into the group. It sits on
          the right so every account name starts at the same left edge — a
          chevron in the leading position indented the groups relative to the
          plain accounts, which read as the hierarchy being one level off. */}
      {opts.expandable && kids.length > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpandedGroups((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            });
          }}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${accountData.dealer || key}`}
          className="flex-shrink-0 ml-0.5 p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
        >
          <ChevronRightIcon
            className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </button>
      )}
      </div>
      {opts.expandable && expanded &&
        kids.map(([childKey, childData]) =>
          renderAccountOption(childKey, childData, `child-${childKey}`, { nested: true }),
        )}
      </div>
    );
  };

  // Client-role users see a static display with no dropdown.
  if (userRole === 'client') {
    if (compact) {
      // Compact client view: just the avatar, centered, no dropdown.
      const label = currentAccount?.dealer || currentKey || 'Your Account';
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
            {currentAccount?.dealer || currentKey || 'Your Account'}
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

  // All-accounts gets the same glyph as its dropdown entry. The empty tile is
  // the "nothing resolved yet" state, and showing it for a scope the user
  // deliberately chose reads as a broken avatar rather than as a scope.
  const triggerAvatar = inAllAccounts ? (
    <span className="w-7 h-7 rounded-md bg-[var(--sidebar-muted)] border border-[var(--sidebar-border)] flex items-center justify-center flex-shrink-0">
      <BuildingStorefrontIcon className="w-4 h-4 text-[var(--sidebar-muted-foreground)]" />
    </span>
  ) : currentAccount ? (
    <AccountSwitcherAvatar
      account={currentAccount}
      accountKey={currentKey}
      isGroup={currentKey ? childCounts[currentKey] > 0 : false}
    />
  ) : (
    <div className="w-7 h-7 rounded-md bg-[var(--sidebar-muted)] flex-shrink-0" />
  );
  const triggerLabel = inAllAccounts
    ? 'All accounts'
    : currentAccount?.dealer || currentKey || 'Select account';

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
            {currentAccount && (
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
          // Wider than the trigger it hangs off: nested rooftops spend horizontal
          // space on the indent and the disclosure, and at the old width a group
          // name plus its badge truncated to "Demo Acco…".
          className="fixed z-[200] w-96 rounded-xl glass-dropdown overflow-hidden animate-fade-in-up"
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
        >
          {/* Search — universal filter for BOTH the organizations and
              account lists, so it scales to many orgs. Placed high so it's
              the first thing you reach when the lists are long. */}
          <div className="p-1.5 border-b border-[var(--border)]">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search accounts..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>

          {/* Scope tier — Organizations are a top-level scope, so they're
              always visible and one-click (selecting one enters roll-up mode
              across its accounts; switching orgs is just clicking another).
              Filtered by the search above and bounded so many orgs scroll in
              place rather than burying the account list. Hidden while a
              search matches no orgs. */}
          {/* Organizations are no longer a separate scope. A group (Young
              Automotive Group) is an Account with rooftops beneath it, so it
              appears in the account list below like any other account —
              selecting it gives the normal account nav plus a roll-up across
              its children. */}

          {/* All accounts — a SCOPE, so it sits above the lists rather than
              inside them: picking it is not picking an account, it is
              stepping back to see every one of them at once. Hidden while
              searching (the search filters accounts, and a scope is not a
              search result) and on surfaces with no cross-account view. */}
          {offersAllAccounts && !search && (
            <div className="p-2 border-b border-[var(--border)]">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setSearch('');
                  confirmNavigation(() => {
                    setAccount({ mode: 'all' });
                    onSwitch?.();
                  });
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg hover:bg-[var(--muted)] transition-colors text-left"
              >
                <span className="w-7 h-7 rounded-md bg-[var(--muted)] border border-[var(--border)] flex items-center justify-center flex-shrink-0">
                  <BuildingStorefrontIcon className="w-4 h-4 text-[var(--muted-foreground)]" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[var(--foreground)] truncate">
                    All accounts
                  </p>
                  <p className="text-[10px] text-[var(--muted-foreground)] truncate leading-tight">
                    Every account in one view
                  </p>
                </div>
                {inAllAccounts && (
                  <CheckIcon className="w-3.5 h-3.5 text-[var(--primary)] flex-shrink-0" />
                )}
              </button>
            </div>
          )}

          {/* Recently viewed — quick shortcuts under the search; hidden while
              searching so the results below read cleanly. Small matched label. */}
          {!search && recentAccounts.length > 0 && (
            <div className="p-2 border-b border-[var(--border)]">
              <p className="px-2.5 pt-0.5 pb-1.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Recently viewed
              </p>
              {recentAccounts.map(([key, accountData]) => renderAccountOption(key, accountData, `recent-${key}`))}
            </div>
          )}

          {/* Accounts — scoped to the active org (never a mixed pool),
              filtered by search. Label matches "Recently viewed" and names the
              org when scoped so the shorter list is self-explanatory. */}
          <div className="p-2">
            <p className="px-2.5 pt-0.5 pb-1.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Accounts
            </p>
            <div className="max-h-[320px] space-y-0.5 overflow-y-auto pr-0.5">
              {!accountsLoaded ? (
                <p className="text-xs text-[var(--muted-foreground)] text-center py-4">Loading...</p>
              ) : filteredAccounts.length === 0 ? (
                <p className="text-xs text-[var(--muted-foreground)] text-center py-4">
                  {search ? 'No accounts match your search' : 'No accounts available'}
                </p>
              ) : search ? (
                // SEARCHING FLATTENS. A search has to reach a rooftop whose
                // group is collapsed, so results are the flat match list —
                // hiding a match inside a closed group is the one behavior that
                // would make the search look broken.
                filteredAccounts.map(([key, accountData]) => renderAccountOption(key, accountData))
              ) : (
                roots.map(([key, accountData]) =>
                  renderAccountOption(key, accountData, key, { expandable: true }),
                )
              )}
            </div>
          </div>

          {settingsHref && (
            <div className="p-1 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setSearch('');
                  router.push(settingsHref);
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <CogIcon className="w-4 h-4" />
                Settings
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

function AccountSwitcherAvatar({
  account,
  accountKey,
  isGroup = false,
}: {
  account: AccountData;
  accountKey: string | null;
  /** Owns sub-accounts — badged on the avatar rather than named in a pill. */
  isGroup?: boolean;
}) {
  // The badge itself lives on AccountAvatar, so a group is recognisable
  // wherever its logo is drawn rather than only inside this picker.
  return (
    <AccountAvatar
      name={account.dealer}
      accountKey={accountKey || account.dealer}
      storefrontImage={account.storefrontImage}
      logos={account.logos}
      size={28}
      isGroup={isGroup}
      className="w-7 h-7 rounded-md object-cover flex-shrink-0 border border-[var(--border)]"
    />
  );
}
