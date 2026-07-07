'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import type { UserRole } from '@/lib/auth';
import { hasUnrestrictedAccountAccess } from '@/lib/roles';
import {
  ADMIN_VALUE,
  readActiveAccountCookie,
  writeActiveAccountCookie,
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
  logos: {
    light: string;
    dark: string;
    white?: string;
    black?: string;
  };
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
    };
  };
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
}

export type AccountType =
  | { mode: 'admin' }
  | { mode: 'account'; accountKey: string };

interface AccountContextValue {
  account: AccountType;
  setAccount: (account: AccountType) => void;
  isAdmin: boolean;
  /** User has full (all-account) access — drives font roll-up, etc. */
  isUnrestricted: boolean;
  isAccount: boolean;
  accountKey: string | null;
  accountData: AccountData | null;
  accounts: Record<string, AccountData>;
  accountsLoaded: boolean;
  refreshAccounts: () => Promise<void>;
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
  const [initialized, setInitialized] = useState(false);

  // Set default mode when session loads.
  // If on a sub-account route, defer to the SubaccountLayout which syncs from URL.
  useEffect(() => {
    if (status === 'authenticated' && !initialized) {
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/subaccount/')) {
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
        if (cookieVal && cookieVal !== ADMIN_VALUE) {
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

  const setAccount = (newAccount: AccountType) => {
    // Account role users cannot switch to admin mode
    if (userRole === 'client' && newAccount.mode === 'admin') return;
    // Admin users with explicit assignments can only switch to assigned accounts
    if (userRole === 'admin' && newAccount.mode === 'account' && userAccountKeys.length > 0) {
      if (!userAccountKeys.includes(newAccount.accountKey)) return;
    }
    setAccountState(newAccount);
    // Persist so the selection survives reloads and stays in sync across the
    // studio / app / reporting surfaces (shared parent-domain cookie).
    writeActiveAccountCookie(
      newAccount.mode === 'admin' ? ADMIN_VALUE : newAccount.accountKey,
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

  const isAdmin = account.mode === 'admin';
  const isAccount = account.mode === 'account';
  const accountKey = account.mode === 'account' ? account.accountKey : null;
  const accountData = accountKey ? accounts[accountKey] || null : null;

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
        accountKey,
        accountData,
        accounts,
        accountsLoaded,
        refreshAccounts,
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
