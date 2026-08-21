'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

interface PageProps {
  params: Promise<{ tab: string }>;
}

/** Old per-tab URLs onto the merged section's sub-tabs. */
const SECTIONS: Record<string, string> = {
  sending: 'sending',
  sms: 'sending',
  suppressions: 'suppressions',
};

/**
 * Email/SMS/Suppressions settings moved into Settings → Studio Settings →
 * Email & Texts (2026-08-20). This admin-scoped URL has no slug of its own,
 * so the redirect runs on the client: useSubaccountHref resolves the selected
 * account to /subaccount/<slug>/settings/email-texts.
 *
 * With no account selected there is nothing per-account to configure, so fall
 * through to the agency settings landing rather than guessing.
 */
export default function LegacyMessagingSettingsTab({ params }: PageProps) {
  const { tab } = use(params);
  const router = useRouter();
  const subHref = useSubaccountHref();

  useEffect(() => {
    const section = SECTIONS[tab] ?? 'sending';
    const href = subHref('/settings/email-texts');
    router.replace(
      href.startsWith('/subaccount/') ? `${href}?section=${section}` : '/settings',
    );
  }, [tab, subHref, router]);

  return null;
}
