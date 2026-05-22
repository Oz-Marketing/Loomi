'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import type { UserRole } from '@/lib/auth';

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
  // Loomi-native sending identity. Used by EmailCampaign sends when set;
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
      .then(r => r.json())
      .then((data: Record<string, AccountData>) => {
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
  };

  const refreshAccounts = useCallback(async () => {
    try {
      const data: Record<string, AccountData> = await fetch('/api/accounts').then(r => r.json());
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
