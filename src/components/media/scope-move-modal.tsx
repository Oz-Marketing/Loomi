'use client';

import { useMemo, useState } from 'react';
import { Select } from '@/components/select';
import { MAJOR_US_OEMS, POWERSPORTS_BRANDS } from '@/lib/oems';

/**
 * Move assets between scopes.
 *
 * The gap this closes: an asset uploaded to the wrong place had no way out.
 * Folders never offered it either — they moved assets WITHIN a scope — so this
 * is new capability rather than a restored one.
 *
 * Deliberately explicit about consequence. Promoting to an OEM library publishes
 * an asset to every rooftop carrying that brand, and the destination line says
 * so in words before anyone confirms.
 */

export interface ScopeMoveTarget {
  accountKey: string | null;
  oem: string | null;
}

export function ScopeMoveModal({
  /** How many assets are being moved — 1 for a single asset. */
  count,
  /** Name shown when moving exactly one. */
  singleName,
  accounts,
  onCancel,
  onConfirm,
  busy = false,
  mode = 'move',
}: {
  count: number;
  singleName?: string;
  accounts: { key: string; dealer: string }[];
  onCancel: () => void;
  onConfirm: (target: ScopeMoveTarget) => void;
  busy?: boolean;
  /**
   * `copy` leaves the original where it is and puts an independent second asset
   * in the destination. Same picker, because the destinations are the same set
   * — only the verb and what it does to the source differ.
   */
  mode?: 'move' | 'copy';
}) {
  const isCopy = mode === 'copy';
  // One control, not two. Scope is a single choice — offering an account picker
  // AND a brand picker invites the both-at-once combination the API rejects.
  //
  // Copy starts on a sub-account, not the Loomi library: copying is nearly
  // always "give this to that rooftop", and a fleet-wide publish should never
  // be what happens when someone confirms without reading.
  const [value, setValue] = useState(
    isCopy && accounts.length > 0 ? `account:${accounts[0].key}` : 'global',
  );

  const options = useMemo(() => {
    const brands = [...MAJOR_US_OEMS, ...POWERSPORTS_BRANDS];
    return [
      { value: 'global', label: 'Loomi library — every account' },
      ...brands.map((b) => ({ value: `oem:${b}`, label: `Shared — all ${b} accounts` })),
      ...accounts.map((a) => ({ value: `account:${a.key}`, label: a.dealer })),
    ];
  }, [accounts]);

  const target = useMemo<ScopeMoveTarget>(() => {
    if (value.startsWith('oem:')) return { accountKey: null, oem: value.slice(4) };
    if (value.startsWith('account:')) return { accountKey: value.slice(8), oem: null };
    return { accountKey: null, oem: null };
  }, [value]);

  const subject = count === 1 ? 'it' : 'them';
  const copySubject = count === 1 ? 'the copy' : 'the copies';
  const consequence = isCopy
    ? target.oem
      ? `Every account carrying ${target.oem} will be able to use ${copySubject}.`
      : target.accountKey
        ? `Only this account will be able to use ${copySubject}. The original stays where it is.`
        : `Every account will be able to use ${copySubject}. The original stays where it is.`
    : target.oem
      ? `Every account carrying ${target.oem} will be able to use ${subject}.`
      : target.accountKey
        ? `Only this account will be able to use ${subject}.`
        : `Every account will be able to use ${subject}.`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={busy ? undefined : onCancel}>
      <div className="glass-modal w-[460px]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-base font-semibold">
            {count === 1
              ? isCopy ? 'Copy asset' : 'Move asset'
              : `${isCopy ? 'Copy' : 'Move'} ${count} assets`}
          </h3>
          {count === 1 && singleName && (
            <p className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]">{singleName}</p>
          )}
        </div>

        <div className="space-y-3 p-5">
          <div>
            <label className="mb-2 block text-sm text-[var(--muted-foreground)]">
              {isCopy ? 'Copy to' : 'Move to'}
            </label>
            <Select value={value} onChange={setValue} options={options} />
          </div>

          <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">{consequence}</p>

          {/* The one genuinely surprising part of each verb, stated rather than
              discovered: a move keeps every existing link working because the
              stored file never moves, and a copy is genuinely independent
              rather than a second pointer at one file. */}
          <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">
            {isCopy
              ? count === 1
                ? 'The copy gets its own file — renaming, replacing or deleting it later won’t touch the original.'
                : 'The copies get their own files — renaming, replacing or deleting them later won’t touch the originals.'
              : 'The file\u2019s URL doesn\u2019t change, so anything already using it — a landing page, a sent email, a built ad — keeps working.'}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(target)}
            disabled={busy}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? (isCopy ? 'Copying…' : 'Moving…') : isCopy ? 'Copy' : 'Move'}
          </button>
        </div>
      </div>
    </div>
  );
}
