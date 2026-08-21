'use client';

/**
 * Reporting's own settings: which reports each account's CLIENT users see.
 *
 * The same `ReportAccessTab` that sits on an account, with an account picker in
 * front of it. Two reasons it's here as well as there:
 *
 *   • Reporting had nothing of its own once Appearance moved to the modal, and
 *     a sector with an empty settings panel reads as broken.
 *   • This is the question you actually arrive with — "who sees what" — and
 *     answering it per account meant leaving Reporting, opening Agency
 *     Settings, finding the account, then finding the tab. The picker turns
 *     that into one control.
 *
 * Staff-only: narrowing what a client sees is not something a client does. The
 * registry gates the tab on `hasAdminAccess`, and the report-access API gates
 * every write again.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAccount } from '@/contexts/account-context';
import { Select, type SelectOption } from '@/components/select';
import { AccountAvatar } from '@/components/account-avatar';
import { formatAccountCityState } from '@/lib/account-resolvers';
import { ReportAccessTab } from '@/components/settings/report-access-tab';

export function ClientReportsTab() {
  const { accounts, accountsLoaded, accountKey, scopedAccountKeys, isGroup } = useAccount();

  const options: SelectOption[] = useMemo(() => {
    const keys = isGroup && scopedAccountKeys?.length ? scopedAccountKeys : Object.keys(accounts ?? {});
    return keys
      .map((key) => {
        const a = accounts?.[key];
        const dealer = (a?.dealer ?? '').trim() || key;
        const where = formatAccountCityState(a);
        return { value: key, label: where ? `${dealer} · ${where}` : dealer };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [accounts, isGroup, scopedAccountKeys]);

  // Default to the account already in scope — you usually came here about the
  // one you were looking at. Falls back to the first alphabetically.
  const [selected, setSelected] = useState('');
  useEffect(() => {
    if (selected || options.length === 0) return;
    const inScope = accountKey && options.some((o) => o.value === accountKey);
    setSelected(inScope ? accountKey! : options[0]!.value);
  }, [selected, options, accountKey]);

  if (!accountsLoaded) {
    return <p className="text-sm text-[var(--muted-foreground)]">Loading accounts…</p>;
  }

  if (options.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        No accounts to configure yet.
      </p>
    );
  }

  const account = selected ? accounts?.[selected] : null;

  return (
    <div className="space-y-5">
      <section className="glass-section-card rounded-xl p-5">
        <label className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">
          Account
        </label>
        <div className="flex items-center gap-3">
          {account && (
            <AccountAvatar
              name={account.dealer || selected}
              accountKey={selected}
              storefrontImage={account.storefrontImage}
              logos={account.logos}
              size={36}
              className="flex-shrink-0 rounded-lg border border-[var(--border)]"
            />
          )}
          <div className="min-w-0 flex-1 max-w-md">
            <Select
              value={selected}
              onChange={setSelected}
              options={options}
              previewFont={false}
              ariaLabel="Account to configure"
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          Report visibility is per account — each one&rsquo;s clients see only what&rsquo;s enabled
          below.
        </p>
      </section>

      {/* No `onIntegrate`: the Integrations tab it would jump to lives on the
          account, not here, so the cards link out on their own instead. */}
      {selected && <ReportAccessTab accountKey={selected} />}
    </div>
  );
}
