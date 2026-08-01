'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ExclamationTriangleIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { DatePicker } from '@/components/ui/date-picker';
import type { PacerAd, PacerPlan } from '@/lib/ad-pacer/types';
import { COLORS } from '@/lib/ad-pacer/constants';
import { makeAd, num, sourceColor } from '@/lib/ad-pacer/helpers';
import { flightDatePresets, fmtPeriodLong } from '@/lib/ad-pacer/period';
import { DollarInput, inputClass, labelClass } from './inputs';
import { BudgetSourceToggle } from './toggles';
import { Tooltip } from './Tooltip';

type BudgetSource = 'base' | 'added' | 'split';

interface DraftRow {
  key: string;
  name: string;
  budgetSource: BudgetSource;
  allocation: string;
  flightStart: string | null;
  flightEnd: string | null;
}

// One row to start — "Add row" is right there, and empty rows just add noise
// for the common case of adding a single ad.
const STARTING_ROWS = 1;

let rowSeq = 0;
function blankRow(): DraftRow {
  rowSeq += 1;
  return {
    key: `r${rowSeq}`,
    name: '',
    budgetSource: 'base',
    allocation: '',
    flightStart: null,
    flightEnd: null,
  };
}

/** A row the user has started filling in (so blanks can be ignored silently). */
function isTouched(r: DraftRow): boolean {
  return (
    r.name.trim() !== '' ||
    r.allocation.trim() !== '' ||
    r.flightStart != null ||
    r.flightEnd != null
  );
}

/**
 * Bulk ad-set creation, and strictly that: a spreadsheet-ish grid for the four
 * fields worth typing up front — name (required), budget source, allocation,
 * flight dates. Deliberately NOT a calculator; budget targets, spreading and
 * pool totals live on the planner's Base/Added cards and the Calculator, so
 * there's exactly one place that does budget math. Everything else (creative,
 * approvals, owner, pacing) is filled in afterwards by opening the ad.
 */
export function BulkAddAdsModal({
  plan,
  onClose,
  onCreate,
}: {
  /** Live plan — supplies the period and the position for new rows. */
  plan: PacerPlan;
  onClose: () => void;
  onCreate: (ads: PacerAd[]) => void;
}) {
  const period = plan.period;
  const [rows, setRows] = useState<DraftRow[]>(() =>
    Array.from({ length: STARTING_ROWS }, blankRow),
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = (key: string, next: Partial<DraftRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));
  const addRow = () => setRows((prev) => [...prev, blankRow()]);
  const removeRow = (key: string) =>
    setRows((prev) =>
      prev.length === 1 ? [blankRow()] : prev.filter((r) => r.key !== key),
    );

  // A name is all that's required — budget and dates can be filled in later,
  // inline on the plan table.
  const touched = rows.filter(isTouched);
  const unnamed = touched.filter((r) => r.name.trim() === '');
  const ready = touched.filter((r) => r.name.trim() !== '');

  const handleCreate = () => {
    if (ready.length === 0) return;
    onCreate(
      ready.map((r, i) => {
        const amount = num(r.allocation);
        return {
          ...makeAd(plan.ads.length + i, period),
          name: r.name.trim(),
          budgetSource: r.budgetSource,
          allocation: amount != null && amount > 0 ? amount.toFixed(2) : null,
          flightStart: r.flightStart,
          flightEnd: r.flightEnd,
        };
      }),
    );
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto py-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="glass-modal relative mx-4 flex max-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="m-0 truncate text-lg font-bold text-[var(--foreground)]">
              Add ad sets · {fmtPeriodLong(period)}
            </h2>
            <p className="m-0 text-[11px] text-[var(--muted-foreground)]">
              Only the name is required — budget and flight dates can be filled
              in later, and creative and approvals live inside the ad set.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Rows */}
        <div className="themed-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-2 hidden grid-cols-[1fr_240px_150px_240px_32px] gap-2.5 md:grid">
            <span className={labelClass}>Ad name</span>
            <span className={labelClass}>Budget source</span>
            <span className={labelClass}>Allocation</span>
            <span className={labelClass}>Flight dates</span>
            <span />
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => {
              const needsName = isTouched(r) && r.name.trim() === '';
              return (
                <div
                  key={r.key}
                  className="grid grid-cols-1 items-start gap-2.5 md:grid-cols-[1fr_240px_150px_240px_32px]"
                >
                  <div>
                    <input
                      value={r.name}
                      autoFocus={i === 0}
                      onChange={(e) => patch(r.key, { name: e.target.value })}
                      placeholder={`Ad ${i + 1} name…`}
                      aria-label={`Ad ${i + 1} name`}
                      className={inputClass}
                      style={
                        needsName ? { borderColor: COLORS.warn } : undefined
                      }
                    />
                    {needsName && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-[var(--muted-foreground)]">
                        <ExclamationTriangleIcon
                          className="h-3 w-3"
                          style={{ color: COLORS.warn }}
                        />
                        Needs a name
                      </span>
                    )}
                  </div>
                  <BudgetSourceToggle
                    stretch
                    value={r.budgetSource}
                    onChange={(v) => patch(r.key, { budgetSource: v })}
                  />
                  <div style={{ color: sourceColor(r.budgetSource) }}>
                    <DollarInput
                      value={r.allocation}
                      onChange={(v) => patch(r.key, { allocation: v })}
                      placeholder="0.00"
                    />
                  </div>
                  <DatePicker
                    mode="range"
                    value={{ start: r.flightStart, end: r.flightEnd }}
                    onChange={(range) =>
                      patch(r.key, {
                        flightStart: range.start,
                        flightEnd: range.end,
                      })
                    }
                    placeholder="Pick a flight window"
                    presets={flightDatePresets(period)}
                  />
                  <Tooltip label="Remove row">
                    <button
                      type="button"
                      onClick={() => removeRow(r.key)}
                      aria-label="Remove row"
                      className="rounded-lg p-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-red-400"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </Tooltip>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={addRow}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/50 hover:text-[var(--foreground)]"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add row
          </button>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
          <span className="text-[11px] text-[var(--muted-foreground)]">
            {unnamed.length > 0
              ? `${unnamed.length} row${unnamed.length === 1 ? '' : 's'} still ${
                  unnamed.length === 1 ? 'needs' : 'need'
                } a name.`
              : ready.length > 0
                ? `${ready.length} ad set${ready.length === 1 ? '' : 's'} ready.`
                : 'Blank rows are ignored.'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={ready.length === 0 || unnamed.length > 0}
              className="rounded-lg border border-[var(--primary)] bg-[var(--primary)]/90 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {ready.length > 1
                ? `Create ${ready.length} ad sets`
                : 'Create ad set'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
