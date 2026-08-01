'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { ChannelIcon } from '@/components/icons/channel-icon';
import { BUDGET_CHANNELS } from '@/lib/budget/channels';
import { periodOf } from '@/lib/budget/period';
import { MONTH_ABBR } from './budget-shared';

/**
 * One-off budget line — channel, month, amount. Everything else takes defaults.
 *
 * A modal rather than an inline panel: expanding in place pushed the grid down
 * and reflowed the page around a four-field form, so the thing you were
 * looking at moved the moment you went to add to it.
 */
export function BudgetAddLineModal({
  year,
  accountName,
  onAdd,
  onClose,
}: {
  year: number;
  accountName: string;
  onAdd: (body: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [channel, setChannel] = useState(BUDGET_CHANNELS[0]!.key);
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

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
    setSaving(true);
    await onAdd({
      channel,
      period: periodOf(year, Number(month)),
      amount: n,
      label: label.trim() || null,
      source: 'adhoc',
    });
    setSaving(false);
    onClose();
  }

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="frost-heavy flex w-full max-w-md flex-col overflow-hidden rounded-2xl shadow-2xl"
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
          <div className="grid grid-cols-2 gap-3">
            <div>
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
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--foreground)]">Amount</label>
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
            {saving ? 'Adding…' : 'Add line'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
