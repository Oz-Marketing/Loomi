'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  MagnifyingGlassIcon,
  XMarkIcon,
  DocumentDuplicateIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { useAccount } from '@/contexts/account-context';
import { AccountAvatar } from '@/components/account-avatar';

// Multi-select sub-account picker for ad-hoc clones from the table
// row menu. Fires N sequential POSTs to /api/flows/[id]/duplicate
// (one per selected accountKey) so the same source can be dropped
// into multiple accounts in one pass. For templates, callers pass
// excludeAccountKeys so already-deployed sub-accounts can't be
// double-cloned by accident.

interface CloneFlowModalProps {
  open: boolean;
  flowId: string;
  flowName: string;
  /** Account keys to exclude from the picker. Use this to hide
   *  sub-accounts that already have an instance of a template so the
   *  user doesn't accidentally clone a second copy. Optional. */
  excludeAccountKeys?: string[];
  onClose: () => void;
  /** Called once after all clones finish with the list of created
   *  flow ids. Callers typically refresh the table; if exactly one
   *  flow was created they may navigate to its overview. */
  onCloned: (createdFlowIds: string[]) => void;
}

export function CloneFlowModal({
  open,
  flowId,
  flowName,
  excludeAccountKeys = [],
  onClose,
  onCloned,
}: CloneFlowModalProps) {
  const { accounts } = useAccount();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    if (open) {
      setSearch('');
      setSelected(new Set());
      setCloning(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !cloning) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, cloning, onClose]);

  const excludeSet = useMemo(
    () => new Set(excludeAccountKeys),
    [excludeAccountKeys],
  );

  const accountList = useMemo(() => {
    const entries = Object.entries(accounts)
      .filter(([key]) => !excludeSet.has(key))
      .map(([key, data]) => ({
        key,
        dealer: data.dealer,
        logos: data.logos,
      }));
    entries.sort((a, b) => a.dealer.localeCompare(b.dealer));
    return entries;
  }, [accounts, excludeSet]);

  const filtered = useMemo(() => {
    if (!search.trim()) return accountList;
    const q = search.trim().toLowerCase();
    return accountList.filter(
      (a) =>
        a.dealer.toLowerCase().includes(q) || a.key.toLowerCase().includes(q),
    );
  }, [accountList, search]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((a) => selected.has(a.key));

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const a of filtered) next.delete(a.key);
      } else {
        for (const a of filtered) next.add(a.key);
      }
      return next;
    });
  }

  async function handleClone() {
    if (selected.size === 0 || cloning) return;
    setCloning(true);
    try {
      const keys = [...selected];
      const created: string[] = [];
      const failed: Array<{ accountKey: string; error: string }> = [];
      // Sequential fan-out — the underlying /duplicate operation is
      // a single Prisma transaction, but bursting N parallel requests
      // would just queue them on the same connection. Sequential
      // keeps error reporting clean.
      for (const accountKey of keys) {
        try {
          const res = await fetch(`/api/flows/${flowId}/duplicate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountKey }),
          });
          const payload = await res.json().catch(() => ({}));
          if (!res.ok) {
            failed.push({
              accountKey,
              error: payload.error || `HTTP ${res.status}`,
            });
            continue;
          }
          if (payload.flow?.id) created.push(payload.flow.id);
        } catch (err) {
          failed.push({
            accountKey,
            error: err instanceof Error ? err.message : 'Network error',
          });
        }
      }
      if (created.length > 0 && failed.length === 0) {
        toast.success(
          `Cloned to ${created.length} ${created.length === 1 ? 'sub-account' : 'sub-accounts'} as drafts.`,
        );
      } else if (created.length > 0 && failed.length > 0) {
        toast.warning(
          `Cloned to ${created.length}; ${failed.length} failed (${failed
            .map((f) => accounts[f.accountKey]?.dealer || f.accountKey)
            .join(', ')}).`,
        );
      } else {
        toast.error('Clone completed but no flows were created.');
      }
      onCloned(created);
      onClose();
    } finally {
      setCloning(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clone-flow-title"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => !cloning && onClose()}
      />
      <div className="relative z-10 w-full max-w-md flex flex-col rounded-xl border border-[var(--border)] bg-[var(--card-strong)] backdrop-blur-2xl backdrop-saturate-150 shadow-xl overflow-hidden max-h-[80vh]">
        <header className="px-4 py-3 border-b border-[var(--border)] flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3
              id="clone-flow-title"
              className="text-sm font-semibold text-[var(--foreground)] truncate"
            >
              Clone to sub-accounts
            </h3>
            <p className="text-[11px] text-[var(--muted-foreground)] truncate">
              Creates a draft copy of <span className="font-medium text-[var(--foreground)]">{flowName}</span> in each selected sub-account.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !cloning && onClose()}
            disabled={cloning}
            title="Close"
            className="w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-40"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </header>

        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sub-accounts..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </div>
          {filtered.length > 0 && (
            <button
              type="button"
              onClick={toggleAllFiltered}
              className="text-[10px] font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)] px-2 py-1.5"
            >
              {allFilteredSelected ? 'Clear' : 'Select all'}
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-[var(--muted-foreground)]">
                {accountList.length === 0
                  ? 'No sub-accounts available.'
                  : 'No matches for your search.'}
              </p>
            </div>
          ) : (
            <ul className="py-1">
              {filtered.map((account) => {
                const isSelected = selected.has(account.key);
                return (
                  <li key={account.key}>
                    <button
                      type="button"
                      onClick={() => toggle(account.key)}
                      className={`w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors ${
                        isSelected
                          ? 'bg-[var(--primary)]/10 hover:bg-[var(--primary)]/15'
                          : 'hover:bg-[var(--muted)]'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                          isSelected
                            ? 'bg-[var(--primary)] border-[var(--primary)]'
                            : 'border-[var(--border)]'
                        }`}
                      >
                        {isSelected && <CheckIcon className="w-3 h-3 text-white" />}
                      </span>
                      <AccountAvatar
                        name={account.dealer}
                        accountKey={account.key}
                        logos={account.logos}
                        size={24}
                        className="w-6 h-6 rounded-md object-cover flex-shrink-0 border border-[var(--border)]"
                      />
                      <span className="text-xs font-medium text-[var(--foreground)] truncate">
                        {account.dealer}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="px-4 py-3 border-t border-[var(--border)] flex items-center justify-between gap-3">
          <span className="text-[11px] text-[var(--muted-foreground)] tabular-nums">
            {selected.size === 0
              ? 'No sub-accounts selected'
              : `${selected.size} selected`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => !cloning && onClose()}
              disabled={cloning}
              className="px-3 h-9 text-xs rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleClone}
              disabled={selected.size === 0 || cloning}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <DocumentDuplicateIcon className="w-3.5 h-3.5" />
              {cloning ? 'Cloning…' : `Clone${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
