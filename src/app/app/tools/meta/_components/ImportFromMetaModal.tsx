'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowPathIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { MetaBrandIcon } from '@/components/icons/platform-logos';
import { UserPicker as PeopleSearchPicker } from '@/components/user-picker';
import { toast } from '@/lib/toast';
import type { DirectoryUser } from '@/lib/ad-pacer/types';
import { fmt, fmtDate } from '@/lib/ad-pacer/helpers';
import { labelClass, AdStatusPill } from '@/app/app/tools/_shared';

// Meta-only onboarding importer (own /discover API). Split out of
// MetaAdsPlannerTool to shrink the file.
/** Mirror of the server `DiscoveredAdSet` (lib/integrations/meta-ads.ts). */
interface DiscoveredAdSet {
  id: string;
  name: string;
  campaignName: string | null;
  effectiveStatus: string | null;
  active: boolean;
  budgetType: 'Daily' | 'Lifetime';
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  startDate: string | null;
  endDate: string | null;
  periodSpend: number;
  runSpend: number | null;
  alreadyLinked: boolean;
  suggestedStatus: string;
}

/**
 * Bulk-import existing Meta ad sets as pacer rows — the onboarding fast path
 * for a fresh subaccount that already has ads running. Lists every ad set in
 * the account (active-only by default, with a toggle), lets the user check the
 * ones to adopt, optionally stamp owner/designer/rep across the batch, and
 * creates them already linked + synced. Already-imported ad sets show disabled
 * so nothing is double-created.
 */
export function ImportFromMetaModal({
  accountKey,
  period,
  periodLabel,
  users,
  onClose,
  onImported,
}: {
  accountKey: string;
  period: string;
  periodLabel: string;
  users: DirectoryUser[];
  onClose: () => void;
  onImported: (data: unknown) => void;
}) {
  const [adSets, setAdSets] = useState<DiscoveredAdSet[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [ownerId, setOwnerId] = useState('');
  const [designerId, setDesignerId] = useState('');
  const [repId, setRepId] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/meta-ads-pacer/${accountKey}/discover?period=${period}`)
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error(data?.error || 'Failed to load ad sets');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setAdSets(Array.isArray(data?.adSets) ? data.adSets : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load ad sets');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, period]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, importing]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (adSets ?? []).filter((s) => {
      if (!showInactive && !s.active && !s.alreadyLinked) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.campaignName ?? '').toLowerCase().includes(q)
      );
    });
  }, [adSets, search, showInactive]);

  const selectable = useMemo(
    () => visible.filter((s) => !s.alreadyLinked),
    [visible],
  );
  const allSelected =
    selectable.length > 0 && selectable.every((s) => selected.has(s.id));
  const hiddenInactive = useMemo(
    () =>
      showInactive
        ? 0
        : (adSets ?? []).filter((s) => !s.active && !s.alreadyLinked).length,
    [adSets, showInactive],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      if (selectable.length > 0 && selectable.every((s) => prev.has(s.id))) {
        const next = new Set(prev);
        selectable.forEach((s) => next.delete(s.id));
        return next;
      }
      const next = new Set(prev);
      selectable.forEach((s) => next.add(s.id));
      return next;
    });

  const doImport = async () => {
    if (importing || selected.size === 0) return;
    setImporting(true);
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${accountKey}/import?period=${period}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adSetIds: Array.from(selected),
            assignments: {
              ownerUserId: ownerId || null,
              designerUserId: designerId || null,
              accountRepUserId: repId || null,
            },
          }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Import failed.');
        return;
      }
      const n = data?.import?.imported ?? 0;
      const skipped = data?.import?.skipped ?? 0;
      onImported(data);
      toast.success(
        `Imported ${n} ad${n === 1 ? '' : 's'} from Meta.${
          skipped ? ` ${skipped} skipped.` : ''
        }`,
      );
      onClose();
    } catch {
      toast.error('Import failed.');
    } finally {
      setImporting(false);
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center p-4 sm:pt-16 bg-black/50 backdrop-blur-sm"
      onClick={() => !importing && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-modal w-full max-w-2xl rounded-xl flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-base font-bold text-[var(--foreground)] flex items-center gap-2">
              <MetaBrandIcon className="w-4 h-4" />
              Import ad sets from Meta
            </h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Pick which of this account&apos;s ad sets to bring into{' '}
              {periodLabel}. They&apos;re created already linked and synced.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !importing && onClose()}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border)]">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ad sets or campaigns…"
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-[var(--input)] focus:outline-none focus:border-[var(--primary)] text-[var(--foreground)]"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] whitespace-nowrap cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="accent-[var(--primary)]"
            />
            Show paused/archived
          </label>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 py-2 min-h-[160px]">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--muted-foreground)]">
              <ArrowPathIcon className="w-4 h-4 animate-spin" />
              Loading ad sets…
            </div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-[#ef4444]">{error}</div>
          ) : visible.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
              {(adSets ?? []).length === 0
                ? 'No ad sets found in this Meta ad account.'
                : 'No ad sets match your filters.'}
              {hiddenInactive > 0 && (
                <div className="mt-1 text-xs">
                  {hiddenInactive} paused/archived hidden — toggle above to show.
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-3 py-1.5">
                <button
                  type="button"
                  onClick={toggleAll}
                  disabled={selectable.length === 0}
                  className="text-xs font-semibold text-[var(--primary)] hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  {allSelected ? 'Clear all' : 'Select all'}
                </button>
                <span className="text-xs text-[var(--muted-foreground)]">
                  {selected.size} selected
                  {hiddenInactive > 0 && ` · ${hiddenInactive} hidden`}
                </span>
              </div>
              {visible.map((s) => {
                const checked = selected.has(s.id);
                const budgetLabel =
                  s.budgetType === 'Lifetime'
                    ? s.lifetimeBudget != null
                      ? `${fmt(s.lifetimeBudget)} lifetime`
                      : '— lifetime'
                    : s.dailyBudget != null
                      ? `${fmt(s.dailyBudget)}/day`
                      : 'No set budget';
                const flight = s.startDate
                  ? `${fmtDate(s.startDate)} – ${s.endDate ? fmtDate(s.endDate) : 'ongoing'}`
                  : 'Open-ended';
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={s.alreadyLinked}
                    onClick={() => toggle(s.id)}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      s.alreadyLinked
                        ? 'opacity-50 cursor-not-allowed'
                        : checked
                          ? 'bg-[var(--primary)]/10'
                          : 'hover:bg-[var(--muted)]'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                        checked && !s.alreadyLinked
                          ? 'bg-[var(--primary)] border-[var(--primary)]'
                          : 'border-[var(--border)]'
                      }`}
                    >
                      {checked && !s.alreadyLinked && (
                        <CheckIcon className="w-3 h-3 text-white" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--foreground)] truncate">
                          {s.name}
                        </span>
                        {s.alreadyLinked ? (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)] whitespace-nowrap">
                            Imported
                          </span>
                        ) : (
                          <AdStatusPill status={s.suggestedStatus} />
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--muted-foreground)] truncate">
                        {s.campaignName ? `${s.campaignName} · ` : ''}
                        {budgetLabel} · {flight}
                        {s.periodSpend > 0 && ` · ${fmt(s.periodSpend)} spent`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* Footer: bulk assignment + import */}
        <div className="border-t border-[var(--border)] p-5 pt-4">
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label className={labelClass}>Owner</label>
              <PeopleSearchPicker
                value={ownerId || null}
                onChange={(v) => setOwnerId(v ?? '')}
                users={users}
                placeholder="— Unassigned —"
              />
            </div>
            <div>
              <label className={labelClass}>Designer</label>
              <PeopleSearchPicker
                value={designerId || null}
                onChange={(v) => setDesignerId(v ?? '')}
                users={users}
                placeholder="— Unassigned —"
              />
            </div>
            <div>
              <label className={labelClass}>Account Rep</label>
              <PeopleSearchPicker
                value={repId || null}
                onChange={(v) => setRepId(v ?? '')}
                users={users}
                placeholder="— Unassigned —"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => !importing && onClose()}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doImport}
              disabled={importing || selected.size === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importing ? (
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
              ) : (
                <PlusIcon className="w-4 h-4" />
              )}
              {importing
                ? 'Importing…'
                : `Import ${selected.size || ''} ad set${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
