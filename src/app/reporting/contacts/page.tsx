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

/** Dedup key so a person present in multiple rooftops counts once at org level. */
function contactDedupeKey(c: Contact): string {
  const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : '';
  const phone = typeof c.phone === 'string' ? c.phone.replace(/\D/g, '') : '';
  return email || phone || (typeof c.id === 'string' ? c.id : JSON.stringify(c));
}

export default function ReportingContactsPage() {
  const { account, isOrg, scopedAccountKeys } = useAccount();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const accountKey = account.mode === 'account' ? account.accountKey : null;

  // Which rooftops feed this report: a single account, or every child rooftop
  // of the active organization (org roll-up). A stable signature avoids
  // re-running the fetch when the array identity changes but contents don't.
  const keysToFetch = isOrg ? scopedAccountKeys : accountKey ? [accountKey] : [];
  const keysSignature = keysToFetch.join('|');

  useEffect(() => {
    const keys = keysSignature ? keysSignature.split('|') : [];
    if (keys.length === 0) {
      setContacts([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    Promise.all(
      keys.map((key) =>
        fetch(`/api/contacts?accountKey=${encodeURIComponent(key)}&all=true&includeMessaging=true`)
          .then((r) => (r.ok ? r.json() : { contacts: [] }))
          .then((data: { contacts?: Contact[] }) => data.contacts ?? [])
          .catch(() => [] as Contact[]),
      ),
    )
      .then((perAccount) => {
        if (cancelled) return;
        // Union the rooftops, deduping a person shared across rooftops so org
        // totals aren't inflated. Single-account mode has nothing to dedupe.
        const merged = perAccount.flat();
        if (keys.length === 1) {
          setContacts(merged);
          setTotalCount(merged.length);
          return;
        }
        const seen = new Set<string>();
        const deduped: Contact[] = [];
        for (const c of merged) {
          const k = contactDedupeKey(c);
          if (seen.has(k)) continue;
          seen.add(k);
          deduped.push(c);
        }
        setContacts(deduped);
        setTotalCount(deduped.length);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [keysSignature]);

  const subtitle = useMemo(() => {
    if (keysToFetch.length === 0) {
      return 'Pick a sub-account or organization in the sidebar to see contact reporting.';
    }
    if (isOrg) {
      return `Organization roll-up across ${keysToFetch.length} sub-account${keysToFetch.length === 1 ? '' : 's'} — ${totalCount.toLocaleString()} unique contacts.`;
    }
    return `Contact growth, lifecycle, and engagement — ${totalCount.toLocaleString()} total.`;
    // keysToFetch.length + isOrg + totalCount drive the copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSignature, isOrg, totalCount]);

  return (
    <>
      <PageHeader icon={UsersIcon} title="Contact reporting" subtitle={subtitle} />
      {keysToFetch.length > 0 && (
        <ContactAnalytics
          contacts={contacts as never}
          totalCount={totalCount}
          loading={loading}
        />
      )}
    </>
  );
}
