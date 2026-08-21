'use client';

/**
 * Ad automation moved into Studio settings (Settings → Ad Automation): watch
 * scope, offer policy, run caps, run history and the dry run are all setup for
 * the unattended pipeline, so they live in the sector's settings rail now.
 *
 * This route survives for the ONE thing settings can't carry: the dealer-facing
 * card. A client has no settings rail — the sector entry is admin-gated — so a
 * client landing here would be bounced to Appearance. Staff get redirected;
 * clients keep the single decision that's genuinely theirs, which design their
 * automated ads use.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from '@/contexts/account-context';
import { MANAGEMENT_ROLES } from '@/lib/roles';
import { ClientTemplateCard } from '@/components/ad-generator/automation/client-template-card';

export default function AdAutomationRoute() {
  const { accountKey, accountData, userRole } = useAccount();
  const router = useRouter();
  // `userRole` is null until the session resolves. Deciding before then would
  // flash the dealer's card at staff on the way to the redirect.
  const isManager = !!userRole && MANAGEMENT_ROLES.includes(userRole);

  useEffect(() => {
    if (isManager) router.replace('/settings/ad-automation');
  }, [isManager, router]);

  if (userRole === null || isManager) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="h-6 w-40 animate-pulse rounded bg-[var(--muted)]/60" />
        <div className="mt-6 h-48 animate-pulse rounded-2xl bg-[var(--muted)]/40" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="mb-1 text-lg font-semibold text-[var(--foreground)]">Automatic ads</h1>
      <p className="mb-6 max-w-2xl text-xs text-[var(--muted-foreground)]">
        Manufacturer offers for {accountData?.dealer || 'this account'} are turned into ads for you
        each month.
      </p>
      <ClientTemplateCard accountKey={accountKey} accountData={accountData} />
    </div>
  );
}
