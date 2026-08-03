'use client';

import { useCallback, useEffect, useState } from 'react';
import { TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { ChannelIcon } from '@/components/icons/channel-icon';
import { BUDGET_CHANNELS, channelLabel } from '@/lib/budget/channels';
import { MONTH_ABBR, monthIndexOf, usd2, type BudgetLine } from './budget-shared';

/**
 * THE budget panel. One view, whatever you clicked.
 *
 * There were two: a group panel listing a budget's pieces, and a line drawer
 * you drilled into from it — so the same click could land you in either place
 * depending on how many pieces a budget had, and the drawer spent most of its
 * height on Status / Save changes / Close out / Release blocks while the pieces
 * themselves had nowhere to be edited. Now a budget's pieces ARE the panel, and
 * each one is editable where it sits.
 *
 * A single line is a group of one. Same component, no branch.
 *
 * Everything saves as you go — amounts and names on blur, channel and status on
 * change. There is no Save button because there is no draft: each piece is its
 * own ledger line with its own audit trail, and batching four of them behind
 * one button turns a single mistyped field into four events nobody can read.
 */
export function BudgetPanel({
  title,
  period,
  lines,
  onClose,
  onChanged,
}: {
  title: string;
  /** `YYYY-MM`, or empty for pooled money. */
  period: string;
  lines: BudgetLine[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, { amount: string; label: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Re-seed when the lines change, so a field never shows a stale number next
  // to a fresh total.
  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        lines.map((l) => [l.id, { amount: String(l.amount), label: l.label ?? '' }]),
      ),
    );
  }, [lines]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = useCallback(
    async (line: BudgetLine, body: Record<string, unknown>, what: string) => {
      setBusy(line.id);
      try {
        const res = await fetch(`/api/budget/lines/${line.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `Could not save the ${what}`);
        onChanged();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Could not save the ${what}`);
        // Put the field back to what the server still believes.
        setDrafts((d) => ({
          ...d,
          [line.id]: { amount: String(line.amount), label: line.label ?? '' },
        }));
      } finally {
        setBusy(null);
      }
    },
    [onChanged],
  );

  const remove = useCallback(
    async (line: BudgetLine) => {
      setBusy(line.id);
      try {
        // Cancel, not delete — canceled money leaves every rollup but the trail
        // survives, which is the whole point of a ledger.
        const res = await fetch(`/api/budget/lines/${line.id}?toPool=false`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Could not remove that item');
        toast.success(`${line.label || channelLabel(line.channel)} removed`);
        onChanged();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not remove that item');
      } finally {
        setBusy(null);
      }
    },
    [onChanged],
  );

  const total = lines.reduce((t, l) => t + l.amount, 0);
  const spend = lines.reduce((t, l) => t + l.spendTarget, 0);
  const month = monthIndexOf(period);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="animate-overlay-in absolute inset-0 bg-black/40" onClick={onClose} />

      <aside className="animate-slide-in-right frost-heavy relative flex h-full w-full max-w-md flex-col shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-[var(--foreground)]">{title}</h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {month >= 0 ? `${MONTH_ABBR[month]} ${period.slice(0, 4)}` : 'Unassigned'} ·{' '}
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
          <span className="text-xs text-[var(--muted-foreground)]">
            This month{spend > 0 && <> · {usd2(spend)} to spend</>}
          </span>
          <span className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
            {usd2(total)}
          </span>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {lines.map((line, i) => {
            const draft = drafts[line.id] ?? { amount: '', label: '' };
            return (
              <div
                key={line.id}
                style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                className={`animate-fade-in-up rounded-xl border border-[var(--border)] bg-[var(--muted)]/25 px-3 py-3 transition ${
                  busy === line.id ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <ChannelIcon
                    channel={line.channel}
                    className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]"
                  />
                  <input
                    type="text"
                    placeholder={channelLabel(line.channel)}
                    value={draft.label}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [line.id]: { ...draft, label: e.target.value } }))
                    }
                    onBlur={() => {
                      const next = draft.label.trim();
                      if (next !== (line.label ?? '')) {
                        void patch(line, { label: next || null }, 'name');
                      }
                    }}
                    className="loomi-input min-w-0 flex-1 !bg-transparent !px-0 !py-0 !text-sm !font-medium focus:!bg-[var(--input)] focus:!px-2 focus:!py-1"
                  />
                  <button
                    type="button"
                    aria-label="Remove this item"
                    onClick={() => void remove(line)}
                    className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-red-500"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={draft.amount}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [line.id]: { ...draft, amount: e.target.value } }))
                      }
                      onBlur={() => {
                        const next = Number(draft.amount);
                        if (!Number.isFinite(next) || next <= 0) {
                          setDrafts((d) => ({
                            ...d,
                            [line.id]: { ...draft, amount: String(line.amount) },
                          }));
                          return;
                        }
                        if (next !== line.amount) void patch(line, { amount: next }, 'amount');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      className="loomi-input w-full !bg-[var(--input)] !py-1.5 !pl-6 !text-sm"
                    />
                  </div>
                  <SearchableSelect
                    value={line.channel ?? ''}
                    onChange={(v) => void patch(line, { channel: v }, 'channel')}
                    options={BUDGET_CHANNELS.map((c) => ({
                      value: c.key,
                      label: c.label,
                      icon: <ChannelIcon channel={c.key} className="h-4 w-4" />,
                    }))}
                    className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-1.5 !text-xs"
                  />
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--muted-foreground)]">
                    {usd2(line.spendTarget)} to spend · markup {line.markupSnapshot}
                  </span>
                  {/* Base vs added decides which of the Ad Pacer's two goals
                      this money lands in, so it belongs next to the amount
                      rather than behind another click. */}
                  <div className="w-[128px]">
                    <SearchableSelect
                      value={line.bucket}
                      onChange={(v) => void patch(line, { bucket: v }, 'budget source')}
                      searchable={false}
                      options={[
                        { value: 'base', label: 'Base budget' },
                        { value: 'added', label: 'Added budget' },
                      ]}
                      className="!bg-[var(--input)] !rounded-lg !px-2 !py-1 !text-[11px]"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
