'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { PeriodSummary } from '@/lib/ad-pacer/types';
import { fmtDate, sourceLabel } from '@/lib/ad-pacer/helpers';
import { fmtPeriodLong } from '@/lib/ad-pacer/period';
import { inputClass } from '@/app/app/tools/_shared';

// Meta-only "copy plan from another month" modal (own /copy-from API). Split
// out of MetaAdsPlannerTool to shrink the file.
interface CopySourceAd {
  id: string;
  name: string;
  budgetType: string;
  budgetSource: 'base' | 'added' | 'split';
  flightStart: string | null;
  flightEnd: string | null;
}

// Which groups of fields a copy carries over (Change: copy options). Ad
// identity — name, budget type, budget source, recurring, co-op, action — is
// always copied; these are the optional extras.
export interface CopyFieldOptions {
  assignments: boolean; // owner / designer / account rep
  statuses: boolean; // ad + design status
  approvals: boolean; // internal + client approval
  dates: boolean; // flight start/end, live, due, creative due
  budgets: boolean; // allocation, split base, daily budget
  creative: boolean; // creative link, client name, digital details
}
const DEFAULT_COPY_FIELDS: CopyFieldOptions = {
  assignments: true,
  statuses: true,
  approvals: true,
  dates: false,
  budgets: false,
  creative: true,
};
const COPY_FIELD_LABELS: { key: keyof CopyFieldOptions; label: string; hint: string }[] = [
  { key: 'assignments', label: 'Assignments', hint: 'Owner, designer, rep' },
  { key: 'statuses', label: 'Statuses', hint: 'Ad + design status' },
  { key: 'approvals', label: 'Approvals', hint: 'Internal + client' },
  { key: 'creative', label: 'Creative & notes', hint: 'Link, client, details' },
  { key: 'dates', label: 'Flight dates', hint: 'Start/end, live, due' },
  { key: 'budgets', label: 'Budget amounts', hint: 'Allocation, daily, split' },
];

export function CopyPlanModal({
  accountKey,
  targetPeriod,
  periods,
  onClose,
  onCopy,
  platform = 'meta',
}: {
  accountKey: string;
  targetPeriod: string;
  periods: PeriodSummary[];
  onClose: () => void;
  onCopy: (
    from: string,
    adIds: string[],
    fields: CopyFieldOptions,
  ) => Promise<void>;
  // Which platform's lines the source-period preview loads. Defaults to Meta so
  // existing callers are unchanged; the Google tool passes 'google'.
  platform?: 'meta' | 'google';
}) {
  const sources = useMemo(
    () => periods.filter((p) => p.period !== targetPeriod && p.adCount > 0),
    [periods, targetPeriod],
  );
  const [sourcePeriod, setSourcePeriod] = useState<string>(
    sources[0]?.period ?? '',
  );
  const [ads, setAds] = useState<CopySourceAd[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [fields, setFields] = useState<CopyFieldOptions>(DEFAULT_COPY_FIELDS);

  useEffect(() => {
    if (!sourcePeriod) {
      setAds([]);
      return;
    }
    let cancelled = false;
    setAds(null);
    setLoadError(null);
    setSelected(new Set());
    fetch(
      `/api/meta-ads-pacer/${accountKey}?period=${sourcePeriod}${platform === 'google' ? '&platform=google' : ''}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ ads: CopySourceAd[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.ads) ? data.ads : [];
        setAds(list);
        // Pre-select all so the common "copy everything" path is one click
        setSelected(new Set(list.map((a) => a.id)));
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, sourcePeriod]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const allSelected = ads != null && ads.length > 0 && selected.size === ads.length;

  const toggleAll = () => {
    if (!ads) return;
    setSelected(allSelected ? new Set() : new Set(ads.map((a) => a.id)));
  };
  const toggleOne = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleCopy = async () => {
    if (selected.size === 0 || !sourcePeriod) return;
    setCopying(true);
    try {
      await onCopy(sourcePeriod, Array.from(selected), fields);
      onClose();
    } catch {
      // error surfaced via parent's save status
      setCopying(false);
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:pt-16 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-modal w-full max-w-lg rounded-xl p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-[var(--foreground)]">
              Copy ads to {fmtPeriodLong(targetPeriod)}
            </h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Ad name and budget type/source always copy. Choose what else to
              carry over below.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-3">
          <label className="block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
            Copy from
          </label>
          <select
            value={sourcePeriod}
            onChange={(e) => setSourcePeriod(e.target.value)}
            className={inputClass}
          >
            {sources.map((p) => (
              <option key={p.period} value={p.period}>
                {fmtPeriodLong(p.period)} — {p.adCount} ad
                {p.adCount !== 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
              Pick ads to copy
            </span>
            {ads && ads.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="text-[11px] text-[var(--primary)] hover:underline"
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
            {loadError ? (
              <div className="px-3 py-6 text-center text-xs text-red-400">
                {loadError}
              </div>
            ) : ads == null ? (
              <div className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
                Loading ads…
              </div>
            ) : ads.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
                That month has no ads.
              </div>
            ) : (
              ads.map((ad) => {
                const checked = selected.has(ad.id);
                return (
                  <label
                    key={ad.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--muted)]/40 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(ad.id)}
                      className="w-4 h-4 accent-[var(--primary)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[var(--foreground)] truncate">
                        {ad.name || 'Untitled Ad'}
                      </div>
                      <div className="text-[10px] text-[var(--muted-foreground)] flex items-center gap-2">
                        <span>{ad.budgetType}</span>
                        <span>·</span>
                        <span>
                          {sourceLabel(ad.budgetSource)}
                        </span>
                        {ad.flightStart && ad.flightEnd && (
                          <>
                            <span>·</span>
                            <span>
                              {fmtDate(ad.flightStart)} – {fmtDate(ad.flightEnd)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* What to carry over — defaults match the old behavior (identity +
            statuses/approvals/assignments/creative on; dates + budgets off). */}
        <div className="mb-4">
          <span className="block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
            Carry over
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {COPY_FIELD_LABELS.map(({ key, label, hint }) => (
              <label
                key={key}
                className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--muted)]/40 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={fields[key]}
                  onChange={(e) =>
                    setFields((f) => ({ ...f, [key]: e.target.checked }))
                  }
                  className="w-4 h-4 mt-0.5 accent-[var(--primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-[var(--foreground)]">
                    {label}
                  </span>
                  <span className="block text-[10px] text-[var(--muted-foreground)]">
                    {hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={selected.size === 0 || copying}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--primary)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--primary)]/90 transition-colors"
          >
            {copying
              ? 'Copying…'
              : `Copy ${selected.size} ad${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
