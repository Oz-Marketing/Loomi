'use client';

import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import type { UserRole } from '@/lib/auth';
import { hasUnrestrictedAccountAccess } from '@/lib/roles';
import { getCurrentSurface } from '@/lib/cross-site';
import {
  ADMIN_VALUE,
  ALL_VALUE,
  readSelfScope,
  writeSelfScope,
  readActiveAccountCookie,
  writeActiveAccountCookie,
  parseOrgValue,
} from '@/lib/active-account';

export interface AccountData {
  slug?: string;
  dealer: string;
  category?: string;
  oem?: string;
  oems?: string[];
  email?: string;
  phone?: string;
  salesPhone?: string;
  servicePhone?: string;
  partsPhone?: string;
  phoneSales?: string;
  phoneService?: string;
  phoneParts?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  website?: string;
  timezone?: string;
  /** Resolved logos for DISPLAY — a sub-account's own values, with its
   *  organization's brand kit filling any gaps. */
  logos: {
    light: string;
    dark: string;
    white?: string;
    black?: string;
  };
  /** The sub-account's OWN logos (no org inheritance) — for edit forms, so
   *  saving never persists inherited values back onto the account. */
  ownLogos?: {
    light?: string;
    dark?: string;
    white?: string;
    black?: string;
  } | null;
  storefrontImage?: string;
  branding?: {
    colors?: {
      primary?: string;
      secondary?: string;
      accent?: string;
      background?: string;
      text?: string;
    };
    fonts?: {
      heading?: string;
      body?: string;
      /** Family name (e.g. "Gotham") the Ad Generator's "Brand default" font
       *  resolves to for this account — an uploaded custom font or a system
       *  family. Distinct from heading/body (which are CSS stacks for email). */
      brandDefault?: string;
    };
  };
  /** The sub-account's OWN branding (no org inheritance) — for edit forms. */
  ownBranding?: {
    colors?: Record<string, string>;
    fonts?: Record<string, string>;
  } | null;
  /** Uploaded custom font files (e.g. OEM-required), per account. */
  customFonts?: { family: string; weight?: string; style?: string; url: string }[];
  customValues?: Record<string, { name: string; value: string }>;
  previewValues?: Record<string, string>;
  accountRepId?: string | null;
  accountRep?: {
    id: string;
    name: string;
    title?: string | null;
    email: string;
    avatarUrl?: string | null;
  } | null;
  // Per-account markup override for the Meta Ads Pacer calculator.
  // When null/undefined, the calculator falls back to the global default
  // (0.77). Actual spend = client gross × markup.
  markup?: number | null;
  // Facebook ad account ("act_...") for the Meta Ads Pacer's Sync-from-
  // Facebook job. Empty/undefined = not connected.
  metaAdAccountId?: string | null;
  // Reporting margin (%) for the Meta Ads report — set on the Meta Ads card.
  facebookAdsMargin?: number | null;
  // Loomi-native sending identity. Used by EmailBlast sends when set;
  // otherwise the global SMTP_FROM env var is used.
  senderEmail?: string | null;
  senderName?: string | null;
  sendingDomain?: string | null;
  replyToEmail?: string | null;
  /**
   * Parent account key, or null for a top-level account. This is the
   * hierarchy that replaces the separate Organization concept: a group
   * (e.g. Young Automotive Group) is just an Account whose rooftops point
   * at it, so it can both send its own campaigns and roll up its children.
   */
  parentAccountKey?: string | null;
}

/**
 * The active scope.
 *
 * `admin` is no longer a place the user can be. Agency scope was retired when
 * platform config moved into the Agency Settings modal (the cog in the top
 * bar) — the account switcher lists sub-accounts and nothing else. What's left
 * of `admin` is the UNRESOLVED state: the window between "session is
 * authenticated" and "we know which sub-account to open", plus the case where
 * the user can see no accounts at all. `resolveDefaultAccountKey` closes that
 * window as soon as the account list lands.
 */
export type AccountType =
  | { mode: 'admin' }
  /**
   * The ALL-ACCOUNTS overview — a scope the user deliberately picked, which is
   * what separates it from `admin` above. `accountKey` is null in both, so every
   * cross-account view keys off the same null check it always did; the
   * difference is only that this one is never auto-resolved away.
   *
   * Projects and Reporting. Not Studio — its tools are per-account, so "no
   * account" is not a view any of them have, and the effect below returns a
   * Studio route to a real account rather than leaving its pages empty.
   *
   * Reporting was excluded until its reports could actually aggregate: they
   * gated roll-up on `isGroup`, which is false when nothing is selected, so the
   * scope advertised a roll-up most reports did not do. They now gate on
   * `isRollup` ("does this scope span more than one account"), and the reports
   * with a roll-up config render one. The rest still ask for a single account —
   * see REPORTS WITHOUT A ROLL-UP in docs, they need per-report aggregation.
   *
   * The effect below returns any other surface to a real account rather than
   * leaving its pages with nothing selected. Individual cross-account pages on
   * a surface that does NOT offer the scope can still opt back in by path, via
   * ALL_ACCOUNTS_PATHS — Playbooks does. See docs/account-scope.md.
   */
  | { mode: 'all' }
  | { mode: 'account'; accountKey: string };

/** Surfaces where the all-accounts scope is offered and allowed to persist. */
export const ALL_ACCOUNTS_SURFACES = ['app', 'reporting'] as const;

/**
 * Individual pages that are cross-account views even though their surface is
 * not, listed by path prefix.
 *
 * The exclusion above is about Studio's TOOLS — Contacts, Campaigns, Websites —
 * which are per-account and would render "pick an account" with nothing
 * selected. Playbooks is the opposite kind of page: its whole subject is the
 * comparison ACROSS accounts, so "no account" is its most useful state, not a
 * broken one.
 *
 * Kept as a path list rather than adding 'studio' to the surfaces above, which
 * would offer the scope on every Studio page and break most of them — and would
 * make it possible to land on Contacts in all-accounts scope and export a list
 * mixing unrelated clients.
 *
 * The rule for deciding which pages belong here is in `docs/account-scope.md`.
 */
export const ALL_ACCOUNTS_PATHS = ['/playbooks'] as const;

/** Does this path opt into the all-accounts scope? Pure, so it is testable. */
export function pathOffersAllAccounts(pathname: string): boolean {
  return ALL_ACCOUNTS_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Is the all-accounts scope available where we are right now? */
export function allAccountsSurface(): boolean {
  const surface = getCurrentSurface();
  if (surface != null && (ALL_ACCOUNTS_SURFACES as readonly string[]).includes(surface)) {
    return true;
  }
  if (typeof window === 'undefined') return false;
  return pathOffersAllAccounts(window.location.pathname);
}

/**
 * Where a user with no stored selection should land.
 *
 * An Organization first — a group account rolls its rooftops up, so it's the
 * widest view anyone gets now that agency scope is gone, and the largest one is
 * the closest thing to "home" for an agency user. Falls back to the first
 * account by display name so the choice is at least stable between loads.
 */
export function resolveDefaultAccountKey(
  accounts: Record<string, AccountData>,
  descendantCounts: Record<string, number>,
): string | null {
  const keys = Object.keys(accounts);
  if (keys.length === 0) return null;
  const byName = (a: string, b: string) =>
    (accounts[a]?.dealer || a).localeCompare(accounts[b]?.dealer || b);
  const organizations = keys
    .filter((key) => (descendantCounts[key] ?? 0) > 0)
    .sort((a, b) => (descendantCounts[b] ?? 0) - (descendantCounts[a] ?? 0) || byName(a, b));
  return organizations[0] ?? [...keys].sort(byName)[0] ?? null;
}

interface AccountContextValue {
  account: AccountType;
  setAccount: (account: AccountType) => void;
  /**
   * The scope hasn't resolved to a sub-account (yet). This used to mean "the
   * switcher is in Agency View" and gated fleet-wide roll-up views; agency
   * scope is gone, so in practice this is only true for the first paint after
   * login, or for a user who can see no accounts at all. Don't hang new
   * behaviour off it — for "does this user manage the platform", read
   * `userRole`; for "does this account roll up others", read `isGroup`.
   */
  isAdmin: boolean;
  /** User has full (all-account) access — drives font roll-up, etc. */
  isUnrestricted: boolean;
  isAccount: boolean;
  /** The deliberate all-accounts overview scope (Reporting / Projects only). */
  isAllAccounts: boolean;
  /**
   * Does the current selection span MORE THAN ONE account — i.e. should a view
   * roll up?
   *
   * This is the question almost every caller of `isGroup` was really asking.
   * `isGroup` is structural ("this account owns others") and derived, so it
   * could never be false for Young Automotive Group — which meant YAG's own
   * campaigns were unreachable: every report rolled up the moment a rooftop
   * pointed at it. Use `isRollup` for "how should I render", and keep `isGroup`
   * for "what kind of account is this" (the avatar badge, the group settings
   * tab).
   */
  isRollup: boolean;
  /** A group is being viewed as itself. Always false for a leaf account. */
  isSelfScoped: boolean;
  /** Switch the active group between rolling up and standing alone. */
  setRollup: (rollup: boolean) => void;
  accountKey: string | null;
  accountData: AccountData | null;
  accounts: Record<string, AccountData>;
  accountsLoaded: boolean;
  /**
   * True once the active scope (admin / org / account) has been resolved from
   * the cookie/URL on first load. Consumers that route off the current mode
   * (e.g. the Settings tab guard) must wait for this to avoid acting on the
   * default 'admin' mode before the real scope settles.
   */
  initialized: boolean;
  refreshAccounts: () => Promise<void>;
  /**
   * The account keys implied by the current selection — the client-side analog
   * of the server's getAccountScope. Powers roll-up views that fan out across
   * accounts (contacts, reporting):
   *   - account mode → the active account PLUS any accounts beneath it in the
   *                    hierarchy (a group rolls up its rooftops; a leaf account
   *                    resolves to just itself)
   *   - org mode     → the org's child rooftops (legacy; being retired)
   *   - admin mode   → every account the user can see
   */
  scopedAccountKeys: string[];
  /**
   * True when the active account has accounts beneath it — i.e. it's a group
   * (Young Automotive Group) rather than a single rooftop. Roll-up pages use
   * this to decide whether to aggregate; it replaces `isOrg`.
   */
  isGroup: boolean;
  /**
   * How many accounts sit beneath each account, keyed by account key. Only
   * parents appear. Lets the switcher label a group ("40 rooftops") so a group
   * is visually distinguishable from a plain sub-account in the same list.
   */
  childCounts: Record<string, number>;
  userRole: UserRole | null;
  userName: string | null;
  userTitle: string | null;
  userEmail: string | null;
  userAvatarUrl: string | null;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();

  const userRole = (session?.user?.role as UserRole) ?? null;
  const userAccountKeys: string[] = session?.user?.accountKeys ?? [];
  const userAccountKeysSignature = userAccountKeys.join('|');
  // Full-access users (developer / super_admin / admin with no assignments) see
  // every account, so brand fonts uploaded to any subaccount roll up to them.
  const isUnrestricted = userRole ? hasUnrestrictedAccountAccess(userRole, userAccountKeys) : false;
  const userName = session?.user?.name ?? null;
  const userTitle = session?.user?.title ?? null;
  const userEmail = session?.user?.email ?? null;
  const userAvatarUrl = session?.user?.avatarUrl ?? null;

  const [account, setAccountState] = useState<AccountType>({ mode: 'admin' });
  const [accounts, setAccounts] = useState<Record<string, AccountData>>({});
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  // Route changes have to re-run the resolve effect below. Without this the
  // provider only ever saw the path it mounted on.
  const pathname = usePathname();
  const [initialized, setInitialized] = useState(false);

  // Set default mode when session loads.
  // If on a sub-account route, defer to the SubaccountLayout which syncs from URL.
  useEffect(() => {
    if (status === 'authenticated' && !initialized) {
      // On a scoped URL route (/subaccount/<slug> or /org/<slug>), the route's
      // layout hydrates the scope from the slug — defer to it rather than
      // restoring from the cookie (which could momentarily fight the URL).
      if (
        typeof window !== 'undefined' &&
        (window.location.pathname.startsWith('/subaccount/') ||
          window.location.pathname.startsWith('/org/'))
      ) {
        setInitialized(true);
        return;
      }

      // Cross-surface account restore: ?account=<key> in the URL means
      // "the other surface was active in this account when the user
      // clicked the cross-link". Honor it before falling back to defaults,
      // then strip the param from the URL so a refresh doesn't re-lock to it.
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const accountParam = params.get('account');
        if (accountParam) {
          // Restrict to the user's allowed keys (clients + assignment-scoped
          // admins). Developers / super_admins / unrestricted admins can
          // land in any account; if accounts haven't loaded yet, we still
          // accept the param and let `setAccount` validate on later updates.
          const restricted =
            (userRole === 'client' && userAccountKeys.length > 0) ||
            (userRole === 'admin' && userAccountKeys.length > 0);
          if (!restricted || userAccountKeys.includes(accountParam)) {
            setAccountState({ mode: 'account', accountKey: accountParam });
            // Persist the handed-off account so it survives reloads and is
            // shared with the other surfaces.
            writeActiveAccountCookie(accountParam);
            setInitialized(true);
            params.delete('account');
            const q = params.toString();
            window.history.replaceState(
              {},
              '',
              window.location.pathname +
                (q ? `?${q}` : '') +
                window.location.hash,
            );
            return;
          }
        }
      }

      // Restore the shared active account (cookie) — persists across reloads
      // and stays in sync across the studio / app / reporting surfaces. An
      // account key restores account mode (if the role may access it);
      // ADMIN_VALUE / unset falls through to the role default below.
      if (typeof window !== 'undefined') {
        const cookieVal = readActiveAccountCookie();
        // A legacy `org:<id>` cookie from before Organizations were retired.
        // Ignore it and fall through to the role default rather than stranding
        // the user in a scope that no longer exists.
        const cookieOrgId = parseOrgValue(cookieVal);
        // The all-accounts scope, restored only where it is offered — landing
        // on a Studio route with this cookie set should open an account, not
        // strand every per-account page with nothing selected.
        if (cookieVal === ALL_VALUE && userRole !== 'client' && allAccountsSurface()) {
          setAccountState({ mode: 'all' });
          setInitialized(true);
          return;
        }
        if (cookieVal && cookieVal !== ADMIN_VALUE && cookieVal !== ALL_VALUE && !cookieOrgId) {
          const restricted =
            (userRole === 'client' && userAccountKeys.length > 0) ||
            (userRole === 'admin' && userAccountKeys.length > 0);
          if (!restricted || userAccountKeys.includes(cookieVal)) {
            setAccountState({ mode: 'account', accountKey: cookieVal });
            setInitialized(true);
            return;
          }
        }
      }

      if (userRole === 'client' && userAccountKeys.length > 0) {
        setAccountState({ mode: 'account', accountKey: userAccountKeys[0] });
      } else {
        // Unresolved, not "agency scope" — the effect below opens a default
        // sub-account once the account list arrives.
        setAccountState({ mode: 'admin' });
      }
      setInitialized(true);
    }
  }, [status, initialized, userRole, userAccountKeys]);

  const filterAccountsForCurrentUser = useCallback(
    (allAccounts: Record<string, AccountData>) => {
      if (userRole === 'developer' || userRole === 'super_admin') return allAccounts;
      if (userRole === 'admin' && userAccountKeys.length === 0) return allAccounts;

      const filtered: Record<string, AccountData> = {};
      for (const key of userAccountKeys) {
        if (allAccounts[key]) filtered[key] = allAccounts[key];
      }
      return filtered;
    },
    [userRole, userAccountKeysSignature]
  );

  // Fetch accounts when authenticated
  useEffect(() => {
    if (status !== 'authenticated') return;

    fetch('/api/accounts')
      .then(async (r) => {
        // Guard against error responses (e.g. a 500 returns `{ error }`) — without
        // this the error body gets treated as an account map, surfacing a phantom
        // "error" sub-account in the switcher.
        if (!r.ok) throw new Error(`/api/accounts ${r.status}`);
        return (await r.json()) as Record<string, AccountData>;
      })
      .then((data) => {
        setAccounts(filterAccountsForCurrentUser(data));
        setAccountsLoaded(true);
      })
      .catch(() => setAccountsLoaded(true));
  }, [status, filterAccountsForCurrentUser]);

  const setAccount = (newAccount: AccountType) => {
    // Account role users cannot switch to admin or org mode
    if (userRole === 'client' && newAccount.mode !== 'account') return;
    // Admin users with explicit assignments can only switch to assigned accounts
    if (userRole === 'admin' && newAccount.mode === 'account' && userAccountKeys.length > 0) {
      if (!userAccountKeys.includes(newAccount.accountKey)) return;
    }
    setAccountState(newAccount);
    // Persist so the selection survives reloads and stays in sync across the
    // studio / app / reporting surfaces (shared parent-domain cookie).
    writeActiveAccountCookie(
      newAccount.mode === 'admin'
        ? ADMIN_VALUE
        : newAccount.mode === 'all'
          ? ALL_VALUE
          : newAccount.accountKey,
    );
  };

  const refreshAccounts = useCallback(async () => {
    try {
      const r = await fetch('/api/accounts');
      if (!r.ok) return;
      const data: Record<string, AccountData> = await r.json();
      setAccounts(filterAccountsForCurrentUser(data));
    } catch {}
  }, [filterAccountsForCurrentUser]);

  // Per-account roll-up preference. Read from the shared cookie so a hop
  // between surfaces does not silently change the scope. Roll-up is the default,
  // matching the behavior before the toggle existed.
  const [selfScopedKeys, setSelfScopedKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    const key = account.mode === 'account' ? account.accountKey : null;
    if (!key) return;
    setSelfScopedKeys((prev) => {
      const isSelf = readSelfScope(key);
      if (isSelf === prev.has(key)) return prev;
      const next = new Set(prev);
      if (isSelf) next.add(key);
      else next.delete(key);
      return next;
    });
  }, [account]);

  const isAdmin = account.mode === 'admin';
  const isAllAccounts = account.mode === 'all';
  const isAccount = account.mode === 'account';
  const accountKey = account.mode === 'account' ? account.accountKey : null;
  const accountData = accountKey ? accounts[accountKey] || null : null;

  // parentAccountKey → child keys, built once per accounts map. This is the
  // hierarchy that replaces Organization: a group account's rooftops point at
  // it, so a roll-up is "self + everything beneath me".
  const childrenByParent = useMemo<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    for (const [key, data] of Object.entries(accounts)) {
      const parent = data.parentAccountKey;
      if (!parent) continue;
      (map[parent] ??= []).push(key);
    }
    return map;
  }, [accounts]);

  /** The account plus every account beneath it. Depth-first, cycle-safe. */
  const descendantsOf = useCallback(
    (rootKey: string): string[] => {
      const out: string[] = [];
      const seen = new Set<string>();
      const stack = [rootKey];
      while (stack.length) {
        const key = stack.pop()!;
        if (seen.has(key)) continue; // guards a malformed parent cycle
        seen.add(key);
        if (accounts[key]) out.push(key);
        for (const child of childrenByParent[key] ?? []) stack.push(child);
      }
      return out;
    },
    [accounts, childrenByParent],
  );

  // Client-side analog of the server's getAccountScope: the account keys the
  // current selection fans out to.
  const scopedAccountKeys = useMemo<string[]>(() => {
    if (account.mode === 'account') {
      if (!account.accountKey) return [];
      // Self + descendants — unless this group is pinned to itself, in which
      // case the scope IS just itself. This is the whole point of the toggle: a
      // group that advertises for itself has its own numbers, and they were
      // unreachable while the subtree was the only possible answer.
      if (selfScopedKeys.has(account.accountKey)) return [account.accountKey];
      return descendantsOf(account.accountKey);
    }
    // admin / all
    return Object.keys(accounts);
  }, [account, accounts, descendantsOf, selfScopedKeys]);

  // A group is an account with anything beneath it. STRUCTURAL — it answers
  // "what kind of account is this", not "how should this page render". For the
  // latter use `isRollup`, which honours the toggle.
  const isGroup = useMemo<boolean>(() => {
    if (account.mode !== 'account' || !account.accountKey) return false;
    return (childrenByParent[account.accountKey] ?? []).length > 0;
  }, [account, childrenByParent]);

  const isSelfScoped =
    account.mode === 'account' && !!account.accountKey && selfScopedKeys.has(account.accountKey);
  /**
   * The question a rendering decision should ask, stated literally: does this
   * scope cover more than one account?
   *
   * Defined off `scopedAccountKeys` rather than off `isGroup` so every scope
   * answers it correctly with no special cases — a leaf is one, a group rolled
   * up is many, a group standing alone is one (which is what makes its own
   * reports reachable), and the all-accounts overview is many. Deriving it from
   * `isGroup` instead left all-accounts reading as "single account", so a
   * roll-up-capable page rendered for an account it did not have.
   *
   * Gated on `initialized` because the pre-resolution `admin` state fans out to
   * every account, and a page must not flash a roll-up on the way to a single
   * sub-account.
   */
  const isRollup = initialized && scopedAccountKeys.length > 1;

  const setRollup = useCallback(
    (rollup: boolean) => {
      if (account.mode !== 'account' || !account.accountKey) return;
      const key = account.accountKey;
      writeSelfScope(key, !rollup);
      setSelfScopedKeys((prev) => {
        const next = new Set(prev);
        if (rollup) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [account],
  );

  // Descendant count per parent — a group's full subtree, not just its direct
  // children, so a label reads the way a human would count rooftops.
  const childCounts = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const parentKey of Object.keys(childrenByParent)) {
      if (!accounts[parentKey]) continue; // parent not visible to this user
      // descendantsOf includes the root itself; the group isn't its own rooftop.
      const n = descendantsOf(parentKey).length - 1;
      if (n > 0) out[parentKey] = n;
    }
    return out;
  }, [childrenByParent, accounts, descendantsOf]);

  // Close the unresolved window: agency scope isn't a destination any more, so
  // a user who arrives without a stored sub-account (first login, or a stale
  // `admin` cookie from before this changed) gets opened into one as soon as the
  // account list lands. Without this they'd sit in a scope the switcher can no
  // longer name or leave.
  //
  // Scoped URLs are left alone — `SubaccountLayout` hydrates those from the
  // slug, and racing it would swap the account out from under the page.
  useEffect(() => {
    if (!initialized || !accountsLoaded) return;
    // `admin` is always resolved away — it is the unresolved state, never a
    // destination. `all` is a real choice, so it only gets resolved on the
    // surfaces that do not offer it (Studio), where a null account would leave
    // per-sub-account pages with nothing to render.
    // Re-evaluated on every navigation (see the `pathname` dependency). Before
    // all-accounts was reachable from a Studio page, leaving the scope always
    // meant a cross-host load, so mounting was enough. Now you can walk from
    // Playbooks to Contacts inside one React tree, and without this the scope
    // would follow you onto a page that cannot aggregate — which is exactly the
    // mixed-client roster docs/account-scope.md exists to prevent.
    if (account.mode === 'all' && allAccountsSurface()) return;
    if (account.mode === 'account') return;
    if (
      typeof window !== 'undefined' &&
      (window.location.pathname.startsWith('/subaccount/') ||
        window.location.pathname.startsWith('/org/'))
    ) {
      return;
    }
    const defaultKey = resolveDefaultAccountKey(accounts, childCounts);
    if (!defaultKey) return; // no visible accounts — nothing to open
    setAccountState({ mode: 'account', accountKey: defaultKey });
    writeActiveAccountCookie(defaultKey);
  }, [initialized, accountsLoaded, account.mode, accounts, childCounts, pathname]);

  // Don't render until the very first session is resolved.
  // After initialization, keep rendering children during session refreshes
  // to avoid unmounting the entire app and losing page-level state.
  if (status === 'loading' && !initialized) return null;

  return (
    <AccountContext.Provider
      value={{
        account,
        setAccount,
        isAdmin,
        isUnrestricted,
        isAccount,
        isAllAccounts,
        isRollup,
        isSelfScoped,
        setRollup,
        accountKey,
        accountData,
        accounts,
        accountsLoaded,
        initialized,
        refreshAccounts,
        scopedAccountKeys,
        isGroup,
        childCounts,
        userRole,
        userName,
        userTitle,
        userEmail,
        userAvatarUrl,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return ctx;
}
