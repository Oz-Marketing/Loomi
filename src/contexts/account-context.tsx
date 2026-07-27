'use client';

import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import type { UserRole } from '@/lib/auth';
import { hasUnrestrictedAccountAccess } from '@/lib/roles';
import {
  ADMIN_VALUE,
  readActiveAccountCookie,
  writeActiveAccountCookie,
  encodeOrgValue,
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
  /** Parent organization id, or null for a standalone sub-account. */
  organizationId?: string | null;
  /**
   * Parent account key, or null for a top-level account. This is the
   * hierarchy that replaces the separate Organization concept: a group
   * (e.g. Young Automotive Group) is just an Account whose rooftops point
   * at it, so it can both send its own campaigns and roll up its children.
   */
  parentAccountKey?: string | null;
}

/** An organization (parent grouping) as seen by the switcher. */
export interface OrganizationData {
  id: string;
  key: string;
  slug?: string | null;
  name: string;
  logos?: string | null;
  branding?: string | null;
  /** The org's primary ("house") sub-account key — where its own operating
   *  work lives. null = no primary designated yet. */
  primaryAccountKey?: string | null;
  /** Child sub-account keys under this organization. */
  accountKeys: string[];
}

export type AccountType =
  | { mode: 'admin' }
  | { mode: 'org'; organizationId: string }
  | { mode: 'account'; accountKey: string };

interface AccountContextValue {
  account: AccountType;
  setAccount: (account: AccountType) => void;
  isAdmin: boolean;
  /** User has full (all-account) access — drives font roll-up, etc. */
  isUnrestricted: boolean;
  isAccount: boolean;
  /** True when an organization (roll-up) is the active selection. */
  isOrg: boolean;
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
  /** Active organization id, or null when not in org mode. */
  organizationId: string | null;
  /** Active organization's data, or null when not in org mode. */
  organizationData: OrganizationData | null;
  /** All organizations visible to the user, keyed by org key. */
  organizations: Record<string, OrganizationData>;
  organizationsLoaded: boolean;
  refreshOrganizations: () => Promise<void>;
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
  const [organizations, setOrganizations] = useState<Record<string, OrganizationData>>({});
  const [organizationsLoaded, setOrganizationsLoaded] = useState(false);
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
        // Organization (roll-up) mode. Clients never enter org mode; other
        // roles restore it and let the fetched org list validate later.
        const cookieOrgId = parseOrgValue(cookieVal);
        if (cookieOrgId && userRole !== 'client') {
          setAccountState({ mode: 'org', organizationId: cookieOrgId });
          setInitialized(true);
          return;
        }
        if (cookieVal && cookieVal !== ADMIN_VALUE && !cookieOrgId) {
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

  // Fetch organizations when authenticated (scoped server-side to what the
  // user can see). Powers the switcher's org groups + org (roll-up) mode.
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (userRole === 'client') {
      setOrganizationsLoaded(true);
      return;
    }

    // Organizations are retired — the account hierarchy (parentAccountKey)
    // replaced them and the /api/organizations endpoint is gone. The map stays
    // (empty) so the few remaining readers keep compiling until they're
    // removed with the model itself.
    setOrganizations({});
    setOrganizationsLoaded(true);
  }, [status, userRole]);

  // Recover from a stale org scope. The active-scope cookie is shared across
  // studio/app/reporting and stores `org:<id>`; once an organization is deleted
  // — or once Organization is retired entirely — that id resolves to nothing and
  // the user is stranded in a mode with no accountKey and no data. Fall back to
  // admin (and let the normal cookie write correct it) instead.
  useEffect(() => {
    if (!organizationsLoaded) return;
    if (account.mode !== 'org') return;
    const stillExists = Object.values(organizations).some((o) => o.id === account.organizationId);
    if (!stillExists) {
      setAccountState({ mode: 'admin' });
    }
  }, [organizationsLoaded, organizations, account]);

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
        : newAccount.mode === 'org'
          ? encodeOrgValue(newAccount.organizationId)
          : newAccount.accountKey,
    );
  };

  // No-op: organizations are retired (see the loader above).
  const refreshOrganizations = useCallback(async () => {}, []);

  const refreshAccounts = useCallback(async () => {
    try {
      const r = await fetch('/api/accounts');
      if (!r.ok) return;
      const data: Record<string, AccountData> = await r.json();
      setAccounts(filterAccountsForCurrentUser(data));
    } catch {}
  }, [filterAccountsForCurrentUser]);

  const isAdmin = account.mode === 'admin';
  const isAccount = account.mode === 'account';
  const isOrg = account.mode === 'org';
  const organizationId = account.mode === 'org' ? account.organizationId : null;
  const organizationData = organizationId
    ? Object.values(organizations).find((o) => o.id === organizationId) || null
    : null;
  // The operating account. In org mode this resolves to the org's primary
  // ("house") sub-account, so operational pages (campaigns, flows, media, …)
  // that read `accountKey` operate the org's own work. Roll-up pages branch on
  // `isOrg` first, so they still aggregate across all sub-accounts.
  const accountKey =
    account.mode === 'account'
      ? account.accountKey
      : account.mode === 'org'
        ? organizationData?.primaryAccountKey ?? null
        : null;
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
      // Self + descendants, so selecting a group rolls up its rooftops while a
      // leaf account still resolves to just itself.
      return account.accountKey ? descendantsOf(account.accountKey) : [];
    }
    if (account.mode === 'org') {
      const org = Object.values(organizations).find((o) => o.id === account.organizationId);
      return (org?.accountKeys ?? []).filter((k) => accounts[k]);
    }
    // admin
    return Object.keys(accounts);
  }, [account, organizations, accounts, descendantsOf]);

  // A group is an account with anything beneath it. Roll-up pages branch on
  // this instead of `isOrg`.
  const isGroup = useMemo<boolean>(() => {
    if (account.mode === 'org') return true; // legacy path, still a roll-up
    if (account.mode !== 'account' || !account.accountKey) return false;
    return (childrenByParent[account.accountKey] ?? []).length > 0;
  }, [account, childrenByParent]);

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
        isOrg,
        accountKey,
        accountData,
        accounts,
        accountsLoaded,
        initialized,
        refreshAccounts,
        scopedAccountKeys,
        isGroup,
        childCounts,
        organizationId,
        organizationData,
        organizations,
        organizationsLoaded,
        refreshOrganizations,
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
