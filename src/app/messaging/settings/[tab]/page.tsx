'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

interface PageProps {
  params: Promise<{ tab: string }>;
}

const KNOWN_TABS = new Set(['sending', 'sms', 'suppressions']);

/**
 * Email/SMS/Suppressions settings moved back into Settings → Studio Settings
 * (2026-08-20). This admin-scoped URL has no slug of its own, so the redirect
 * has to run on the client: useSubaccountHref resolves the selected account
 * to `/subaccount/<slug>/settings/<tab>`.
 *
 * With no account selected there is nothing per-account to configure, so fall
 * through to the agency settings landing rather than guessing.
 */
export default function LegacyMessagingSettingsTab({ params }: PageProps) {
  const { tab } = use(params);
  const router = useRouter();
  const subHref = useSubaccountHref();

  useEffect(() => {
    const target = KNOWN_TABS.has(tab) ? tab : 'sending';
    const href = subHref(`/settings/${target}`);
    // No slug resolved → subHref returns the path unchanged, which would be
    // the AGENCY settings route. Send those users to the agency landing.
    router.replace(href.startsWith('/subaccount/') ? href : '/settings');
  }, [tab, subHref, router]);

  return null;
}
