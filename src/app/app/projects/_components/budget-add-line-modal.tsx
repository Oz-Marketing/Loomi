'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { ChannelIcon } from '@/components/icons/channel-icon';
import { BUDGET_CHANNELS } from '@/lib/budget/channels';
import { periodOf } from '@/lib/budget/period';
import { splitFlight } from '@/lib/budget/flight';
import { MONTH_ABBR, usd0 } from './budget-shared';

/**
 * Budget in, one of two shapes.
 *
 * A SINGLE MONTH is the ordinary case — channel, month, amount.
 *
 * A FLIGHT is a media buy with real dates. It's one commercial fact (one
 * insertion order, one total) that the ledger has to hold as one row per month,
 * so entering it by hand means doing the day-weighted split in your head and
 * then keeping three rows in sync every time the buy moves. Here you give the
 * range and the total, and the months are derived.
 *
 * The preview is computed locally with the same `splitFlight` the server uses —
 * pure, no round trip — so the months update as the dates are typed and what
 * you see before saving is exactly what gets written.
 *
 * A modal rather than an inline panel: expanding in place pushed the grid down
 * and reflowed the page around the form, so the thing you were looking at moved
 * the moment you went to add to it.
 */
export function BudgetAddLineModal({
  year,
  accountName,
  onAdd,
  onAddFlight,
  onClose,
}: {
  year: number;
  accountName: string;
  onAdd: (body: Record<string, unknown>) => Promise<void>;
  onAddFlight: (body: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'month' | 'flight'>('month');
  const [channel, setChannel] = useState(BUDGET_CHANNELS[0]!.key);
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [startDate, setStartDate] = useState(`${year}-01-01`);
  const [endDate, setEndDate] = useState(`${year}-03-31`);
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  /** The months this flight would create. Recomputed as you type. */
  const preview = useMemo(() => {
    if (mode !== 'flight') return null;
    const n = Number(amount);
    const s = parseISO(startDate);
    const e = parseISO(endDate);
    if (!s || !e) return { error: 'Pick a start and end date.', months: [] };
    if (e < s) return { error: 'The flight ends before it starts.', months: [] };
    return { error: null, months: splitFlight(s, e, Number.isFinite(n) && n > 0 ? n : 0) };
  }, [mode, startDate, endDate, amount]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  async function submit() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Enter an amount');
      return;
    }
    if (mode === 'flight' && preview?.error) {
      toast.error(preview.error);
      return;
    }
    setSaving(true);
    if (mode === 'flight') {
      await onAddFlight({
        channel,
        startDate,
        endDate,
        amount: n,
        label: label.trim() || null,
      });
    } else {
      await onAdd({
        channel,
        period: periodOf(year, Number(month)),
        amount: n,
        label: label.trim() || null,
        source: 'adhoc',
      });
    }
    setSaving(false);
    onClose();
  }

  if (!mounted) return null;

  return createPortal(
    <div
      className="animate-overlay-in fixed inset-0 z-[180] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="animate-modal-in frost-heavy flex w-full max-w-md flex-col overflow-hidden rounded-2xl shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Add a budget line</h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {accountName} · {year}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Single month vs a dated flight. A segmented control rather than a
              checkbox — these are two ways of entering budget, not one with a
              modifier. */}
          <div className="flex rounded-lg bg-[var(--muted)]/40 p-0.5">
            {(['month', 'flight'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  mode === m
                    ? 'bg-[var(--primary)] text-white shadow-sm'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {m === 'month' ? 'Single month' : 'Flight (date range)'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className={mode === 'flight' ? 'col-span-2' : ''}>
              <label className="block text-xs font-medium text-[var(--foreground)]">Channel</label>
              <div className="mt-1">
                <SearchableSelect
                  value={channel}
                  onChange={setChannel}
                  searchable={false}
                  options={BUDGET_CHANNELS.map((c) => ({
                    value: c.key,
                    label: c.label,
                    icon: <ChannelIcon channel={c.key} className="h-4 w-4" />,
                  }))}
                  className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-2 !text-sm"
                />
              </div>
            </div>
            {mode === 'month' && (
              <div>
                <label className="block text-xs font-medium text-[var(--foreground)]">Month</label>
                <div className="mt-1">
                  <SearchableSelect
                    value={month}
                    onChange={setMonth}
                    searchable={false}
                    options={MONTH_ABBR.map((m: string, i: number) => ({
                      value: String(i + 1),
                      label: m,
                    }))}
                    className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-2 !text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          {mode === 'flight' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--foreground)]">
                  First day
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="loomi-input mt-1 w-full !bg-[var(--input)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--foreground)]">
                  Last day
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="loomi-input mt-1 w-full !bg-[var(--input)]"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--foreground)]">
              {mode === 'flight' ? 'Total for the flight' : 'Amount'}
            </label>
            <div className="relative mt-1">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[var(--muted-foreground)]">
                $
              </span>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder="0"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="loomi-input w-full !bg-[var(--input)] !pl-6"
              />
            </div>
          </div>

          {/* What will actually be written. Shown because the day-weighted
              split is the whole feature and is not what most people guess —
              12 days of March is not a third of a three-month buy. */}
          {mode === 'flight' && preview && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/25 px-3 py-2.5">
              {preview.error ? (
                <p className="text-[11px] text-red-500">{preview.error}</p>
              ) : (
                <>
                  <p className="mb-1.5 text-[11px] font-medium text-[var(--muted-foreground)]">
                    Creates {preview.months.length} line
                    {preview.months.length === 1 ? '' : 's'}, split by days
                  </p>
                  <div className="space-y-0.5">
                    {preview.months.map((m) => (
                      <div key={m.period} className="flex items-center justify-between text-xs">
                        <span className="text-[var(--muted-foreground)]">
                          {MONTH_ABBR[Number(m.period.slice(5, 7)) - 1]} {m.period.slice(0, 4)}
                          <span className="ml-1.5 opacity-60">
                            {m.days} day{m.days === 1 ? '' : 's'}
                          </span>
                        </span>
                        <span className="font-medium tabular-nums text-[var(--foreground)]">
                          {usd0(m.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--foreground)]">
              Label <span className="font-normal text-[var(--muted-foreground)]">— optional</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Summer Sales Event"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="loomi-input mt-1 w-full !bg-[var(--input)]"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-3 py-2 text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {saving
              ? 'Adding…'
              : mode === 'flight'
                ? `Book ${preview && !preview.error ? preview.months.length : ''} month${
                    preview && !preview.error && preview.months.length === 1 ? '' : 's'
                  }`.replace('  ', ' ')
                : 'Add line'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function parseISO(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
