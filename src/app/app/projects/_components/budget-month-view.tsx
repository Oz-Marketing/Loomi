'use client';

import { useMemo } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { ChannelIcon } from '@/components/icons/channel-icon';
import { LINE_TYPES, channelLabel } from '@/lib/budget/channels';
import { StatusPill } from './budget-status-pill';
import { MONTH_ABBR, usd0, type BudgetLine } from './budget-shared';

const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * One month, in full.
 *
 * The year grid answers "how is this client's money spread across the year" —
 * twelve columns of totals. It cannot answer "what exactly are we running in
 * March", because a cell is a sum and the lines behind it are one click away
 * each. For anyone working a month — buying it, checking it, closing it out —
 * that's the wrong shape.
 *
 * So this is the same money, rotated: every line in the month, grouped by kind,
 * with its name and status on the row rather than behind a click.
 *
 * Derived entirely from the lines the hub already loaded for the year. A month
 * view that refetched would be a second source of truth for the same numbers.
 */
export function BudgetMonthView({
  year,
  month,
  lines,
  onMonthChange,
  onOpenLine,
}: {
  year: number;
  /** 1–12. */
  month: number;
  lines: BudgetLine[];
  onMonthChange: (month: number) => void;
  onOpenLine: (id: string) => void;
}) {
  const period = `${year}-${String(month).padStart(2, '0')}`;

  const { sections, total, spendTarget } = useMemo(() => {
    const inMonth = lines.filter((l) => l.period === period && l.status !== 'canceled');
    const byType = LINE_TYPES.map((t) => ({
      ...t,
      rows: inMonth
        .filter((l) => l.lineType === t.key)
        .sort((a, b) => b.amount - a.amount),
    })).filter((s) => s.rows.length > 0);
    return {
      sections: byType,
      total: inMonth.reduce((sum, l) => sum + l.amount, 0),
      spendTarget: inMonth.reduce((sum, l) => sum + l.spendTarget, 0),
    };
  }, [lines, period]);

  /** Which months have anything, so the strip shows where the money is. */
  const monthTotals = useMemo(() => {
    const t = Array(12).fill(0);
    for (const l of lines) {
      if (!l.period || l.status === 'canceled') continue;
      const m = Number(l.period.slice(5, 7));
      if (m >= 1 && m <= 12) t[m - 1] += l.amount;
    }
    return t;
  }, [lines]);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
      {/* Month strip. A dropdown would hide which months have money in them,
          which is most of what you want to know before picking one. */}
      <div className="flex items-center gap-1 border-b border-[var(--border)] px-2 py-2">
        <button
          type="button"
          aria-label="Previous month"
          disabled={month <= 1}
          onClick={() => onMonthChange(month - 1)}
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-30"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>

        <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
          {MONTH_ABBR.map((abbr: string, i: number) => {
            const active = i + 1 === month;
            const has = monthTotals[i] > 0;
            return (
              <button
                key={abbr}
                type="button"
                onClick={() => onMonthChange(i + 1)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-center transition ${
                  active
                    ? 'bg-[var(--primary)] text-white'
                    : has
                      ? 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                      : 'text-[var(--muted-foreground)] opacity-50 hover:bg-[var(--muted)]'
                }`}
              >
                <span className="block text-[11px] font-medium">{abbr}</span>
                <span className="mt-0.5 block text-[10px] tabular-nums opacity-80">
                  {has ? usd0(monthTotals[i]) : '—'}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          aria-label="Next month"
          disabled={month >= 12}
          onClick={() => onMonthChange(month + 1)}
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-30"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--border)] px-4 py-3">
        <p className="text-sm font-semibold text-[var(--foreground)]">
          {MONTH_FULL[month - 1]} {year}
        </p>
        <p className="text-xs tabular-nums text-[var(--muted-foreground)]">
          {usd0(total)} budgeted
          {spendTarget > 0 && <> · {usd0(spendTarget)} to spend</>}
        </p>
      </div>

      {sections.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
          Nothing budgeted for {MONTH_FULL[month - 1]}.
        </p>
      ) : (
        <div>
          {sections.map((section) => (
            <div key={section.key}>
              <div className="flex items-baseline justify-between border-b border-[var(--border)] bg-[var(--muted)]/25 px-4 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  {section.label}
                </span>
                <span className="text-[11px] font-semibold tabular-nums text-[var(--muted-foreground)]">
                  {usd0(section.rows.reduce((t, r) => t + r.amount, 0))}
                </span>
              </div>

              {section.rows.map((line, i) => (
                <button
                  key={line.id}
                  type="button"
                  onClick={() => onOpenLine(line.id)}
                  style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
                  className="animate-fade-in-up flex w-full items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 text-left transition last:border-0 hover:bg-[var(--muted)]/40"
                >
                  <ChannelIcon
                    channel={line.channel}
                    className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-[var(--foreground)]">
                      {line.label || channelLabel(line.channel)}
                    </span>
                    {/* The channel only when the name isn't already it —
                        "Radio / Radio" is a row that says one thing twice. */}
                    {line.label && line.label !== channelLabel(line.channel) && (
                      <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                        {channelLabel(line.channel)}
                      </span>
                    )}
                  </span>
                  {line.isCrossAccount && (
                    <span className="hidden whitespace-nowrap rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)] sm:inline">
                      co-op
                    </span>
                  )}
                  <span className="hidden whitespace-nowrap text-[11px] text-[var(--muted-foreground)] sm:inline">
                    {line.bucket === 'base' ? 'Base' : 'Added'}
                  </span>
                  <StatusPill status={line.status} />
                  <span className="w-24 text-right text-sm font-medium tabular-nums text-[var(--foreground)]">
                    {usd0(line.amount)}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
