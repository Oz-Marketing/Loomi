'use client';

import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { AppLogo } from '@/components/app-logo';

/**
 * The active account's logo, picking the variant that reads on the current
 * background (light theme → dark logo, dark theme → light logo, matching the
 * account-avatar / dashboard convention). Falls back to the Loomi logo when the
 * account has no logo set. Used in the client's chrome-less Ad Generator shell,
 * where there's no sidebar to carry the brand.
 */
export function AccountLogo({ className = 'h-8 w-auto max-w-[150px] object-contain' }: { className?: string }) {
  const { accountData } = useAccount();
  const { theme } = useTheme();
  const logo =
    theme === 'light'
      ? accountData?.logos?.dark || accountData?.logos?.light
      : accountData?.logos?.light || accountData?.logos?.dark;
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt={accountData?.dealer || 'Account'} className={className} />;
  }
  return <AppLogo className={className} />;
}
