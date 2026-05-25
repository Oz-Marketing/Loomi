'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  MagnifyingGlassIcon,
  XMarkIcon,
  CheckIcon,
  ArrowUpTrayIcon,
  CheckCircleIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { useAccount } from '@/contexts/account-context';
import { AccountAvatar } from '@/components/account-avatar';

interface ExistingInstanceRef {
  id: string;
  accountKey: string;
}

interface DeployFlowModalProps {
  open: boolean;
  flowId: string;
  flowName: string;
  /** Sub-account keys (with their instance IDs) that already have a
   *  deploy of this template. Rendered in a separate "Already
   *  deployed" section and excluded from selectable targets, so a
   *  template can't be cloned twice into the same account. */
  existingInstances?: ExistingInstanceRef[];
  /** Path prefix for instance links (e.g. /subaccount/<slug>). Plain
   *  '/flows/<id>' for admin context. */
  instanceHrefPrefix?: string;
  onClose: () => void;
  onDeployed: (createdFlowIds: string[]) => void;
}

export function DeployFlowModal({
  open,
  flowId,
  flowName,
  existingInstances = [],
  instanceHrefPrefix = '',
  onClose,
  onDeployed,
}: DeployFlowModalProps) {
  const { accounts } = useAccount();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deploying, setDeploying] = useState(false);

  // Quick lookups for the "already deployed" treatment.
  const existingByAccount = useMemo(() => {
    const map = new Map<string, string>();
    for (const inst of existingInstances) {
      if (inst.accountKey) map.set(inst.accountKey, inst.id);
    }
    return map;
  }, [existingInstances]);

  // Reset state every time the modal opens, so a prior session's
  // selection doesn't bleed through.
  useEffect(() => {
    if (open) {
      setSearch('');
      setSelected(new Set());
      setDeploying(false);
    }
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deploying) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, deploying, onClose]);

  // Split accounts into two buckets: those that don't have an instance
  // yet (selectable) and those that already do (rendered separately,
  // not selectable). A template should never land twice in the same
  // sub-account — to push updates to an existing deploy, the admin
  // uses "Update from template" on the instance, or "Update all" on
  // the template overview.
  const { available, alreadyDeployed } = useMemo(() => {
    const entries = Object.entries(accounts).map(([key, data]) => ({
      key,
      dealer: data.dealer,
      logos: data.logos,
    }));
    entries.sort((a, b) => a.dealer.localeCompare(b.dealer));
    const avail: typeof entries = [];
    const dep: Array<(typeof entries)[number] & { instanceId: string }> = [];
    for (const e of entries) {
      const instanceId = existingByAccount.get(e.key);
      if (instanceId) dep.push({ ...e, instanceId });
      else avail.push(e);
    }
    return { available: avail, alreadyDeployed: dep };
  }, [accounts, existingByAccount]);

  const filtered = useMemo(() => {
    if (!search.trim()) return available;
    const q = search.trim().toLowerCase();
    return available.filter(
      (a) =>
        a.dealer.toLowerCase().includes(q) || a.key.toLowerCase().includes(q),
    );
  }, [available, search]);

  const filteredDeployed = useMemo(() => {
    if (!search.trim()) return alreadyDeployed;
    const q = search.trim().toLowerCase();
    return alreadyDeployed.filter(
      (a) =>
        a.dealer.toLowerCase().includes(q) || a.key.toLowerCase().includes(q),
    );
  }, [alreadyDeployed, search]);

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

  async function handleDeploy() {
    if (selected.size === 0 || deploying) return;
    setDeploying(true);
    try {
      const res = await fetch(`/api/flows/${flowId}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKeys: [...selected] }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Deploy failed');
        return;
      }
      const createdCount = Array.isArray(payload.flows) ? payload.flows.length : 0;
      const failureCount = Array.isArray(payload.failures) ? payload.failures.length : 0;
      if (createdCount > 0 && failureCount === 0) {
        toast.success(
          `Deployed to ${createdCount} ${createdCount === 1 ? 'sub-account' : 'sub-accounts'} as drafts.`,
        );
      } else if (createdCount > 0 && failureCount > 0) {
        toast.warning(
          `Deployed to ${createdCount}; ${failureCount} failed (${payload.failures
            .map((f: { accountKey: string }) => f.accountKey)
            .join(', ')}).`,
        );
      } else {
        toast.error('Deploy completed but no instances were created.');
      }
      const ids = Array.isArray(payload.flows)
        ? payload.flows.map((f: { id: string }) => f.id)
        : [];
      onDeployed(ids);
      onClose();
    } finally {
      setDeploying(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deploy-flow-title"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => !deploying && onClose()}
      />
      <div className="relative z-10 w-full max-w-md flex flex-col rounded-xl border border-[var(--border)] bg-[var(--card-strong)] backdrop-blur-2xl backdrop-saturate-150 shadow-xl overflow-hidden max-h-[80vh]">
        <header className="px-4 py-3 border-b border-[var(--border)] flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3
              id="deploy-flow-title"
              className="text-sm font-semibold text-[var(--foreground)] truncate"
            >
              Deploy to sub-accounts
            </h3>
            <p className="text-[11px] text-[var(--muted-foreground)] truncate">
              Creates a draft copy of <span className="font-medium text-[var(--foreground)]">{flowName}</span> in each selected account.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !deploying && onClose()}
            disabled={deploying}
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
          {filtered.length === 0 && filteredDeployed.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-[var(--muted-foreground)]">
                {available.length === 0 && alreadyDeployed.length === 0
                  ? 'No sub-accounts available.'
                  : 'No matches for your search.'}
              </p>
            </div>
          ) : (
            <>
              {filtered.length > 0 && (
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

              {/* Already-deployed group. Read-only — each entry links
                  to the instance overview where the admin can use
                  "Update from template" if they want a re-sync. */}
              {filteredDeployed.length > 0 && (
                <div className="border-t border-[var(--border)]">
                  <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Already deployed · {filteredDeployed.length}
                  </p>
                  <p className="px-4 pb-2 text-[10px] text-[var(--muted-foreground)] leading-snug">
                    These sub-accounts already have an instance of this template.
                    Open one to update it from the latest template state.
                  </p>
                  <ul className="pb-1">
                    {filteredDeployed.map((account) => (
                      <li key={account.key}>
                        <Link
                          href={`${instanceHrefPrefix}/flows/${account.instanceId}`}
                          onClick={onClose}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-[var(--muted)] transition-colors"
                        >
                          <span className="w-4 h-4 rounded-full bg-green-500/15 flex items-center justify-center flex-shrink-0">
                            <CheckCircleIcon className="w-3 h-3 text-green-400" />
                          </span>
                          <AccountAvatar
                            name={account.dealer}
                            accountKey={account.key}
                            logos={account.logos}
                            size={24}
                            className="w-6 h-6 rounded-md object-cover flex-shrink-0 border border-[var(--border)] opacity-70"
                          />
                          <span className="text-xs font-medium text-[var(--muted-foreground)] truncate flex-1">
                            {account.dealer}
                          </span>
                          <ArrowRightIcon className="w-3 h-3 text-[var(--muted-foreground)] flex-shrink-0" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="px-4 py-3 border-t border-[var(--border)] flex items-center justify-between gap-3">
          <span className="text-[11px] text-[var(--muted-foreground)] tabular-nums">
            {selected.size === 0
              ? 'No accounts selected'
              : `${selected.size} selected`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => !deploying && onClose()}
              disabled={deploying}
              className="px-3 h-9 text-xs rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeploy}
              disabled={selected.size === 0 || deploying}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ArrowUpTrayIcon className="w-3.5 h-3.5" />
              {deploying ? 'Deploying…' : `Deploy${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
