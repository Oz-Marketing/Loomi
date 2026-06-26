'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount } from '@/contexts/account-context';
import { ContactAnalytics } from '@/components/contacts/contact-analytics';
import { UsersIcon } from '@heroicons/react/24/outline';
import { PageHeader } from '@/components/page-header';

/**
 * Contact reporting. Fetches contacts via the existing /api/contacts
 * endpoint (account-scoped) and renders the standalone
 * `ContactAnalytics` component that already powers the studio dashboard
 * embed. Switching the active account refetches.
 */

interface Contact {
  [key: string]: unknown;
}

export default function ReportingContactsPage() {
  const { account } = useAccount();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const accountKey = account.mode === 'account' ? account.accountKey : null;

  useEffect(() => {
    if (!accountKey) {
      setContacts([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/contacts?accountKey=${encodeURIComponent(accountKey)}&all=true&includeMessaging=true`,
    )
      .then((r) => (r.ok ? r.json() : { contacts: [], total: 0 }))
      .then((data: { contacts?: Contact[]; total?: number }) => {
        if (cancelled) return;
        setContacts(data.contacts ?? []);
        setTotalCount(data.total ?? data.contacts?.length ?? 0);
      })
      .catch(() => {
        if (cancelled) return;
        setContacts([]);
        setTotalCount(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey]);

  const subtitle = useMemo(() => {
    if (!accountKey) return 'Pick a sub-account in the sidebar to see contact reporting.';
    return `Contact growth, lifecycle, and engagement — ${totalCount.toLocaleString()} total.`;
  }, [accountKey, totalCount]);

  return (
    <>
      <PageHeader icon={UsersIcon} title="Contact reporting" subtitle={subtitle} />
      {accountKey && (
        <ContactAnalytics
          contacts={contacts as never}
          totalCount={totalCount}
          loading={loading}
        />
      )}
    </>
  );
}
