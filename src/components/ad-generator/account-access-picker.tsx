'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { AccountAvatar } from '@/components/account-avatar';

/**
 * Pick which accounts can use a template.
 *
 * Controlled and self-contained: it renders the list and reports a selection, and
 * saves nothing. That is what lets the library (which PATCHes immediately) and the
 * builder (where nothing is written until Save) show the same control instead of
 * two lists that drift apart — the previous arrangement, where the builder's Share
 * modal wrote straight to the row mid-edit while every other setting on screen was
 * still local.
 *
 * The owner is listed but not toggleable: an account can't lose access to its own
 * template, and a dead switch is worse than a stated fact.
 */
export function AccountAccessPicker({
  ownerKey,
  selected,
  onChange,
  disabled,
}: {
  /** The template's owning account, always granted. Null = shared Loomi library. */
  ownerKey: string | null;
  /** Currently granted keys, excluding the owner. */
  selected: string[];
  onChange: (keys: string[]) => void;
  disabled?: boolean;
}) {
  const { accounts } = useAccount();
  const [query, setQuery] = useState('');

  const list = useMemo(
    () =>
      Object.entries(accounts)
        .filter(([key]) => key !== ownerKey)
        .map(([key, a]) => ({ key, label: a.dealer || key, logos: a.logos, storefrontImage: a.storefrontImage }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [accounts, ownerKey],
  );

  const chosen = useMemo(() => new Set(selected), [selected]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((a) => a.label.toLowerCase().includes(q)) : list;
  }, [list, query]);
  const allSelected = filtered.length > 0 && filtered.every((a) => chosen.has(a.key));

  const toggle = (k: string) => {
    const next = new Set(chosen);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onChange([...next]);
  };
  const toggleAll = () => {
    const next = new Set(chosen);
    if (allSelected) filtered.forEach((a) => next.delete(a.key));
    else filtered.forEach((a) => next.add(a.key));
    onChange([...next]);
  };

  if (list.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-xs text-[var(--muted-foreground)]">
        No other accounts to share with.
      </p>
    );
  }

  return (
    <>
      <div className="relative mb-2">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search accounts…"
          disabled={disabled}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] py-2 pl-8 pr-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)] disabled:opacity-50"
        />
      </div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] text-[var(--muted-foreground)]">
          {chosen.size ? `${chosen.size} added` : 'No one added yet'}
        </span>
        <button
          type="button"
          onClick={toggleAll}
          disabled={disabled || !filtered.length}
          className="text-[11px] font-medium text-[var(--primary)] transition-opacity hover:opacity-80 disabled:opacity-40"
        >
          {allSelected ? 'Clear all' : 'Select all'}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {ownerKey && (
          <div className="flex w-full items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2">
            <AccountAvatar
              name={accounts[ownerKey]?.dealer || ownerKey}
              accountKey={ownerKey}
              logos={accounts[ownerKey]?.logos}
              storefrontImage={accounts[ownerKey]?.storefrontImage}
              size={28}
              className="flex-shrink-0 rounded-md border border-[var(--border)]"
            />
            <span className="min-w-0 flex-1 truncate text-sm text-[var(--foreground)]">
              {accounts[ownerKey]?.dealer || ownerKey}
            </span>
            <span className="flex-shrink-0 rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
              owner
            </span>
          </div>
        )}
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">No matches for &ldquo;{query}&rdquo;.</p>
        ) : (
          filtered.map((a) => {
            const on = chosen.has(a.key);
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => toggle(a.key)}
                role="switch"
                aria-checked={on}
                disabled={disabled}
                className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${on ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--border)] hover:border-[var(--primary)]'}`}
              >
                <AccountAvatar
                  name={a.label}
                  accountKey={a.key}
                  logos={a.logos}
                  storefrontImage={a.storefrontImage}
                  size={28}
                  className="flex-shrink-0 rounded-md border border-[var(--border)]"
                />
                <span className={`min-w-0 flex-1 truncate text-sm ${on ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}>
                  {a.label}
                </span>
                {/* A switch, not a checkbox: this is a state you leave on. */}
                <span
                  className={`relative h-4 w-7 flex-shrink-0 rounded-full transition-colors ${
                    on ? 'bg-[var(--primary)]' : 'border border-[var(--border)] bg-[var(--muted)]'
                  }`}
                >
                  <span
                    className={`absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white shadow transition-all ${on ? 'left-[0.9rem]' : 'left-0.5'}`}
                  />
                </span>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

/**
 * The picker as a modal, still saving nothing.
 *
 * For the builder, where the audience is local state persisted by the same Save
 * (and the same autosave) as the status and the design. The library's
 * `AvailabilityModal` writes immediately because there is nothing else on screen
 * to save with; here a write of its own would race the autosave and would also
 * make the audience unsettable on a template that has never been saved.
 */
export function AccountAccessModal({
  name,
  ownerKey,
  selected,
  onChange,
  onClose,
}: {
  name: string;
  ownerKey: string | null;
  selected: string[];
  onChange: (keys: string[]) => void;
  onClose: () => void;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[var(--foreground)]">Who can use it</h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Pick which accounts can use &ldquo;{name}&rdquo;. They all use this one template, so
              your edits reach every one of them. Saved with the template.
            </p>
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Clearing the list on a library template widens it back to everyone, which
            is not what "I unticked some accounts" usually means. Say so. */}
        {!ownerKey && selected.length > 0 && (
          <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-snug text-amber-500">
            Naming accounts here limits this template to them. Clear the list to offer it to
            everyone again.
          </p>
        )}

        <AccountAccessPicker ownerKey={ownerKey} selected={selected} onChange={onChange} />

        <div className="mt-3 flex justify-end border-t border-[var(--border)] pt-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
