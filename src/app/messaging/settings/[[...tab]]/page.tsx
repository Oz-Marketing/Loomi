'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useParams } from 'next/navigation';
import { useAccount } from '@/contexts/account-context';
import { accountSettingsHref } from '@/lib/account-settings-href';
import { accountTabForMessagingSection } from '@/lib/messaging-settings-redirect';

/**
 * Legacy redirect for the UNSCOPED shape, e.g. /messaging/settings/sending.
 *
 * A client component, unlike its slug-scoped sibling: there's no account in
 * this URL, so the only way to know which one you meant is the active scope,
 * which lives in the account context. Waits for it rather than guessing — a
 * redirect to the wrong account's sending config would be worse than a beat of
 * "Taking you to…".
 */
export default function LegacyMessagingSettingsRedirect() {
  const router = useRouter();
  const params = useParams();
  const { accountKey, initialized } = useAccount();

  useEffect(() => {
    if (!initialized) return;
    const raw = params?.tab;
    const section = Array.isArray(raw) ? raw[0] : raw;
    const tab = accountTabForMessagingSection(section);
    // No account in scope (all-accounts, or a fresh session) — the directory is
    // the honest destination: pick an account, then its Email tab.
    router.replace(accountKey ? accountSettingsHref(accountKey, tab) : '/settings');
  }, [initialized, accountKey, params, router]);

  return (
    <p className="p-6 text-sm text-[var(--muted-foreground)]">Taking you to the account&rsquo;s settings…</p>
  );
}
