'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSubaccountHref } from '@/hooks/use-subaccount-href';

/** Moved into Settings → Studio Settings (2026-08-20). */
export default function LegacyMessagingSettingsIndex() {
  const router = useRouter();
  const subHref = useSubaccountHref();

  useEffect(() => {
    const href = subHref('/settings/sending');
    router.replace(href.startsWith('/subaccount/') ? href : '/settings');
  }, [subHref, router]);

  return null;
}
