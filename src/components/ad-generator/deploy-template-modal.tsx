'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { XMarkIcon, CheckIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { AccountAvatar } from '@/components/account-avatar';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';

/**
 * Deploy an ad template into one or more subaccounts. Each selected account gets
 * its own PUBLISHED copy in its template library (a scoped clone of the doc) — so
 * teams can push a master layout out to the accounts that should have it. Shared
 * by the /templates Ads-tab row menu and the builder's settings cog.
 */
export function DeployTemplateModal({
  name,
  doc,
  onClose,
  onDeployed,
  excludeKey,
}: {
  name: string;
  doc: TemplateDoc;
  onClose: () => void;
  onDeployed?: () => void;
  /** Hide one account (e.g. the template's own scope) from the list. */
  excludeKey?: string | null;
}) {
  const { accounts } = useAccount();
  const list = useMemo(
    () =>
      Object.entries(accounts)
        .filter(([key]) => key !== excludeKey)
        .map(([key, a]) => ({ key, label: a.dealer || key, logos: a.logos, storefrontImage: a.storefrontImage }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [accounts, excludeKey],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((a) => a.label.toLowerCase().includes(q)) : list;
  }, [list, query]);
  // "Select all" acts on what's currently visible (the filtered set).
  const allSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.key));

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

  const deploy = async () => {
    if (!selected.size) return;
    setBusy(true);
    try {
      const results = await Promise.all(
        [...selected].map((accountKey) =>
          fetch('/api/ad-generator/templates-doc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, doc: { ...doc, name }, status: 'published', accountKey }),
          }),
        ),
      );
      const failed = results.filter((r) => !r.ok).length;
      if (failed) throw new Error(`${failed} of ${results.length} could not be created`);
      toast.success(`Deployed to ${selected.size} ${selected.size === 1 ? 'account' : 'accounts'}`);
      onDeployed?.();
      onClose();
    } catch (err) {
      toast.error(`Couldn't deploy: ${err instanceof Error ? err.message : 'unknown error'}`);
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
            <h2 className="text-sm font-bold text-[var(--foreground)]">Deploy to subaccounts</h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Publishes a copy of &ldquo;{name}&rdquo; into each selected account&rsquo;s template library.
            </p>
          </div>
          <button onClick={onClose} title="Close" aria-label="Close" className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-xs text-[var(--muted-foreground)]">No subaccounts available to deploy to.</p>
        ) : (
          <>
            {/* Search */}
            <div className="relative mb-2">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search subaccounts…"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] py-2 pl-8 pr-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] text-[var(--muted-foreground)]">{selected.size} selected</span>
              <button onClick={toggleAll} disabled={!filtered.length} className="text-[11px] font-medium text-[var(--primary)] transition-opacity hover:opacity-80 disabled:opacity-40">
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">No matches for &ldquo;{query}&rdquo;.</p>
              ) : (
                filtered.map((a) => {
                  const on = selected.has(a.key);
                  return (
                    <button
                      key={a.key}
                      onClick={() => toggle(a.key)}
                      aria-pressed={on}
                      className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${on ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--border)] hover:border-[var(--primary)]'}`}
                    >
                      {/* Shared account avatar: logo → storefront → generated Loomi avatar. */}
                      <AccountAvatar name={a.label} accountKey={a.key} logos={a.logos} storefrontImage={a.storefrontImage} size={28} className="flex-shrink-0 rounded-md border border-[var(--border)]" />
                      <span className={`min-w-0 flex-1 truncate text-sm ${on ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}>{a.label}</span>
                      <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px] border ${on ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--muted-foreground)]/50'}`}>
                        {on && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
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
                onClick={deploy}
                disabled={busy || !selected.size}
                className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy ? 'Deploying…' : `Deploy${selected.size ? ` to ${selected.size}` : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
