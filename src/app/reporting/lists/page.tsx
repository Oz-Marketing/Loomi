'use client';

/**
 * Marketing Lists — port of Oz Dealer Tools' `reports/marketing-lists`.
 *
 * ODT's version was a fixed set of hardcoded service-lifecycle buckets (Early
 * Reminder, Routine Reminder, FLF, Lost Souls 1–3) with a size next to each and
 * a BDC call-list export. Loomi's are real, editable segments — the same
 * records Studio calls segments — so the buckets are seeded rather than
 * compiled in, and a store can build its own.
 *
 * ONE ACCOUNT AT A TIME. Sizing evaluates the account's contacts in memory (see
 * the component), and a list's rules can reference that account's custom
 * fields, which mean different things in different stores. A group roll-up
 * would be both expensive and wrong.
 */

import { FunnelIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '../ads/_components/shared';
import { MarketingLists } from './_components/marketing-lists';

export default function ReportingListsPage() {
  const { accountKey, accountData, isGroup } = useAccount();

  const scopeLabel = accountKey && !isGroup ? accountData?.dealer || accountKey : 'select an account';

  return (
    <>
      <PageHeader
        icon={FunnelIcon}
        title="Marketing lists"
        subtitle={`Saved audiences you can size, edit, and send to — ${scopeLabel}.`}
      />

      {isGroup || !accountKey ? (
        <EmptyState
          icon={FunnelIcon}
          title="Pick an account"
          body="Lists are built from one store's contacts and its own custom fields, so choose a single account from the top bar."
        />
      ) : (
        <MarketingLists accountKey={accountKey} />
      )}
    </>
  );
}
