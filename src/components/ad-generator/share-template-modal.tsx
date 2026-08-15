'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { AccountAvatar } from '@/components/account-avatar';

/**
 * Who can use this template.
 *
 * Replaces "Copy to Subaccounts", which cloned the doc into each account: the
 * copies diverged the moment anyone touched one, an edit to the master reached
 * none of them, and access could never be taken back. This grants access to the
 * ONE template instead — so a toggle off is a real revoke, and a later edit
 * reaches everyone at once.
 *
 * Toggles are applied on Save, not per click, so a mis-tap doesn't briefly publish
 * a template into a dealer's library.
 */
export function ShareTemplateModal({
  templateId,
  name,
  ownerKey,
  sharedWith,
  onClose,
  onSaved,
}: {
  templateId: string;
  name: string;
  /** The template's own account scope — always has access, shown as such. */
  ownerKey: string | null;
  /** Accounts currently shared with. */
  sharedWith: string[];
  onClose: () => void;
  onSaved?: (keys: string[]) => void;
}) {
  const { accounts } = useAccount();
  const list = useMemo(
    () =>
      Object.entries(accounts)
        .filter(([key]) => key !== ownerKey)
        .map(([key, a]) => ({ key, label: a.dealer || key, logos: a.logos, storefrontImage: a.storefrontImage }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [accounts, ownerKey],
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set(sharedWith));
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((a) => a.label.toLowerCase().includes(q)) : list;
  }, [list, query]);
  const allSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.key));
  const changed =
    selected.size !== sharedWith.length || sharedWith.some((k) => !selected.has(k));

  const toggle = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) filtered.forEach((a) => next.delete(a.key));
      else filtered.forEach((a) => next.add(a.key));
      return next;
    });

  const save = async () => {
    setBusy(true);
    const keys = [...selected];
    try {
      const res = await fetch(`/api/ad-generator/templates-doc/${templateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sharedAccountKeys: keys }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      toast.success(
        keys.length
          ? `Shared with ${keys.length} sub-account${keys.length === 1 ? '' : 's'}`
          : ownerKey
            ? 'Sharing removed — only its own sub-account can use it'
            : 'Sharing removed — back in the shared library for everyone',
      );
      onSaved?.(keys);
      onClose();
    } catch (err) {
      toast.error(`Couldn't update sharing: ${err instanceof Error ? err.message : 'unknown error'}`);
      setBusy(false);
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[var(--foreground)]">Share template</h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Pick which sub-accounts can use &ldquo;{name}&rdquo;. They all use this one template, so
              your edits reach every one of them.
            </p>
          </div>
          <button onClick={onClose} title="Close" aria-label="Close" className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* What "nothing selected" means depends on whether the template is owned
            by a sub-account, so say it rather than leaving it to be inferred. */}
        {!ownerKey && selected.size > 0 && (
          <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-snug text-amber-500">
            This is a shared-library template. Sharing it with specific sub-accounts also limits it
            to them — clear the list to offer it to everyone again.
          </p>
        )}

        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-xs text-[var(--muted-foreground)]">
            No other sub-accounts to share with.
          </p>
        ) : (
          <>
            <div className="relative mb-2">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sub-accounts…"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] py-2 pl-8 pr-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] text-[var(--muted-foreground)]">
                {selected.size ? `${selected.size} with access` : 'No one added yet'}
              </span>
              <button onClick={toggleAll} disabled={!filtered.length} className="text-[11px] font-medium text-[var(--primary)] transition-opacity hover:opacity-80 disabled:opacity-40">
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {/* The owner is listed but not toggleable — it can't lose access to
                  its own template, and a dead switch is worse than a stated fact. */}
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
                  const on = selected.has(a.key);
                  return (
                    <button
                      key={a.key}
                      onClick={() => toggle(a.key)}
                      role="switch"
                      aria-checked={on}
                      className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${on ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--border)] hover:border-[var(--primary)]'}`}
                    >
                      <AccountAvatar name={a.label} accountKey={a.key} logos={a.logos} storefrontImage={a.storefrontImage} size={28} className="flex-shrink-0 rounded-md border border-[var(--border)]" />
                      <span className={`min-w-0 flex-1 truncate text-sm ${on ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}>{a.label}</span>
                      {/* A switch, not a checkbox: this is a state you leave on. */}
                      <span
                        className={`relative h-4 w-7 flex-shrink-0 rounded-full transition-colors ${
                          on ? 'bg-[var(--primary)]' : 'bg-[var(--muted)] border border-[var(--border)]'
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

            <div className="mt-3 flex justify-end gap-2 border-t border-[var(--border)] pt-3">
              <button onClick={onClose} disabled={busy} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy || !changed}
                className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy ? 'Saving…' : changed ? 'Save access' : 'Saved'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
