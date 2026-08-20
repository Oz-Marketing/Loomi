'use client';

import { useEffect, useState } from 'react';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { AppLogo } from '@/components/app-logo';

/**
 * The active account's logo, picking the variant that reads on the current
 * background (light theme → dark logo, dark theme → light logo, matching the
 * account-avatar / dashboard convention). Falls back to the Loomi logo when the
 * account has no logo set. Used in the client's chrome-less Ad Generator shell,
 * where there's no sidebar to carry the brand.
 *
 * "No logo set" used to mean only an EMPTY field, which turned out to be the
 * wrong test. An audit found 34 logo references across 18 rooftops pointing at
 * files that no longer exist — uploads that landed in the release directory
 * before object storage, destroyed by the next deploy. The field is populated,
 * so the old check passed and the dealer got a broken-image icon in place of
 * their brand.
 *
 * A URL that does not load is not a logo, so `onError` is treated the same as
 * an absent one. That is worth having permanently regardless of the backfill:
 * a deleted object or a typo'd URL should degrade to the Loomi mark, never to
 * a broken image in front of a client.
 */
export function AccountLogo({ className = 'h-8 w-auto max-w-[150px] object-contain' }: { className?: string }) {
  const { accountData } = useAccount();
  const { theme } = useTheme();
  const logo =
    theme === 'light'
      ? accountData?.logos?.dark || accountData?.logos?.light
      : accountData?.logos?.light || accountData?.logos?.dark;

  const [failed, setFailed] = useState(false);
  // Switching account or theme selects a different URL, which deserves its own
  // chance to load — without this, one failure would suppress every logo after
  // it for the rest of the session.
  useEffect(() => setFailed(false), [logo]);

  if (logo && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={logo}
        alt={accountData?.dealer || 'Account'}
        className={className}
        onError={() => setFailed(true)}
      />
    );
  }
  return <AppLogo className={className} />;
}
