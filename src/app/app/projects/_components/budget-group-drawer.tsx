'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowTopRightOnSquareIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { ChannelIcon } from '@/components/icons/channel-icon';
import { channelLabel } from '@/lib/budget/channels';
import { StatusPill } from './budget-status-pill';
import { MONTH_ABBR, monthIndexOf, usd2, type BudgetLine } from './budget-shared';

/**
 * A budget's pieces for one month, editable in place.
 *
 * A budget is laid out as one line per piece, so "Some Sales Event" split into
 * SEM and Search is two ledger rows. Both the year grid and the month view now
 * show the BUDGET as the row — what somebody entered — which leaves the pieces
 * needing somewhere to live. This is that somewhere.
 *
 * It replaced an inline dropdown in the month view. Expanding a row in place
 * pushed everything below it down and gave the pieces nowhere to be edited; a
 * panel has room for actual fields, and it's where every other detail on this
 * page already opens.
 *
 * Amounts save per piece, not as a batch. Each one is its own ledger line with
 * its own audit trail, and a single Save that PATCHes four lines turns one
 * mistyped field into four events nobody can read.
 */
export function BudgetGroupDrawer({
  title,
  period,
  lines,
  onClose,
  onOpenLine,
  onChanged,
}: {
  title: string;
  /** `YYYY-MM`. */
  period: string;
  lines: BudgetLine[];
  onClose: () => void;
  onOpenLine: (id: string) => void;
  onChanged: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  // Re-seed when the underlying lines change (a save, or a different budget)
  // so the fields never show a stale number next to a fresh total.
  useEffect(() => {
    setDrafts(Object.fromEntries(lines.map((l) => [l.id, String(l.amount)])));
  }, [lines]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = useCallback(
    async (line: BudgetLine) => {
      const next = Number(drafts[line.id]);
      if (!Number.isFinite(next) || next <= 0) {
        toast.error('Enter a positive amount');
        return;
      }
      if (next === line.amount) return;
      setSaving(line.id);
      try {
        const res = await fetch(`/api/budget/lines/${line.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ amount: next }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Could not save');
        toast.success(`${line.label || channelLabel(line.channel)} updated`);
        onChanged();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save');
        setDrafts((d) => ({ ...d, [line.id]: String(line.amount) }));
      } finally {
        setSaving(null);
      }
    },
    [drafts, onChanged],
  );

  const total = lines.reduce((t, l) => t + l.amount, 0);
  const month = monthIndexOf(period);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="animate-overlay-in absolute inset-0 bg-black/40" onClick={onClose} />

      <aside className="animate-slide-in-right frost-heavy relative flex h-full w-full max-w-md flex-col shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-[var(--foreground)]">{title}</h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {month >= 0 ? `${MONTH_ABBR[month]} ${period.slice(0, 4)}` : period} ·{' '}
              {lines.length} item{lines.length === 1 ? '' : 's'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-baseline justify-between border-b border-[var(--border)] px-5 py-3">
          <span className="text-xs text-[var(--muted-foreground)]">This month</span>
          <span className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
            {usd2(total)}
          </span>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {lines.map((line, i) => (
            <div
              key={line.id}
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
              className="animate-fade-in-up rounded-xl border border-[var(--border)] bg-[var(--muted)]/25 px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <ChannelIcon
                  channel={line.channel}
                  className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--foreground)]">
                    {line.label || channelLabel(line.channel)}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                    {channelLabel(line.channel)} · {line.bucket === 'base' ? 'Base' : 'Added'}
                  </span>
                </span>
                <StatusPill status={line.status} />
              </div>

              <div className="mt-2 flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={drafts[line.id] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [line.id]: e.target.value }))}
                    // Saving on blur rather than behind a button: there's one
                    // field per row, and a Save per row is more chrome than
                    // the edit deserves.
                    onBlur={() => void save(line)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    disabled={saving === line.id}
                    className="loomi-input w-full !bg-[var(--input)] !py-1.5 !pl-6 !text-sm disabled:opacity-50"
                  />
                </div>
                <span className="w-24 whitespace-nowrap text-right text-[11px] text-[var(--muted-foreground)]">
                  {usd2(line.spendTarget)} to spend
                </span>
                {/* Everything else about a line — its type, cost, status,
                    history — stays in the full drawer rather than being
                    duplicated here badly. */}
                <button
                  type="button"
                  aria-label="Open the full line"
                  onClick={() => onOpenLine(line.id)}
                  className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
