'use client';

import { useMemo, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { ChannelIcon } from '@/components/icons/channel-icon';
import { channelLabel } from '@/lib/budget/channels';
import { Collapse } from '@/components/ui/collapse';
import { StatusPill } from './budget-status-pill';
import { MONTH_ABBR, usd0, type BudgetAgreement, type BudgetLine } from './budget-shared';

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
  budgets,
  onMonthChange,
  onOpenLine,
  onOpenGroup,
}: {
  year: number;
  /** 1–12. */
  month: number;
  lines: BudgetLine[];
  /** Used to name a group — a line only carries its budget's id. */
  budgets: BudgetAgreement[];
  onMonthChange: (month: number) => void;
  onOpenLine: (id: string) => void;
  /** Opens the panel holding a budget's pieces for this month. */
  onOpenGroup: (title: string, lines: BudgetLine[]) => void;
}) {
  const period = `${year}-${String(month).padStart(2, '0')}`;

  /** Budgets peeked open in place. Keyed by budget so it survives a re-sort. */
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /**
   * The month's lines, grouped by the BUDGET they came from.
   *
   * A budget's items are laid out as one line per piece, so a Google buy split
   * into SEM and Search is two rows in the ledger — correct, because the pacer
   * needs channel-level money. But it's the wrong thing to lead with: what
   * someone put in was "Some Sales Event", and the split is detail inside it.
   * So the budget is the row and its pieces are behind it.
   *
   * Lines with no budget — one-offs, ticket money, anything imported — are
   * their own group at the end rather than being hidden inside a fake one.
   */
  const { groups, loose, total, spendTarget } = useMemo(() => {
    const inMonth = lines.filter((l) => l.period === period && l.status !== 'canceled');
    const byBudget = new Map<string, BudgetLine[]>();
    const unlinked: BudgetLine[] = [];

    for (const l of inMonth) {
      if (!l.agreementId) {
        unlinked.push(l);
        continue;
      }
      const rows = byBudget.get(l.agreementId) ?? [];
      rows.push(l);
      byBudget.set(l.agreementId, rows);
    }

    const named = [...byBudget.entries()]
      .map(([id, rows]) => ({
        id,
        // A budget can be archived while its money stays on the year, so fall
        // back to the lines' own label rather than rendering a blank row.
        name: budgets.find((b) => b.id === id)?.name ?? rows[0]?.label ?? 'Budget',
        rows: rows.sort((a, b) => b.amount - a.amount),
        amount: rows.reduce((t, r) => t + r.amount, 0),
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      groups: named,
      loose: unlinked.sort((a, b) => b.amount - a.amount),
      total: inMonth.reduce((sum, l) => sum + l.amount, 0),
      spendTarget: inMonth.reduce((sum, l) => sum + l.spendTarget, 0),
    };
  }, [lines, period, budgets]);

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

      {groups.length === 0 && loose.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
          Nothing budgeted for {MONTH_FULL[month - 1]}.
        </p>
      ) : (
        <div>
          {groups.map((group, gi) => {
            // A budget with one piece has nothing to reveal — send it straight
            // to the line rather than through a panel listing one row.
            const single = group.rows.length === 1;
            const expanded = open.has(group.id);
            return (
              <div
                key={group.id}
                style={{ animationDelay: `${Math.min(gi, 8) * 25}ms` }}
                className="animate-fade-in-up border-b border-[var(--border)] last:border-0"
              >
                <div className="flex w-full items-center transition hover:bg-[var(--muted)]/40">
                  {/* Its own hit area. Peeking at what a budget is going
                      towards shouldn't open the panel, and opening the panel
                      shouldn't collapse what you were reading. */}
                  {single ? (
                    <span className="w-9 flex-shrink-0" />
                  ) : (
                    <button
                      type="button"
                      aria-label={expanded ? `Hide ${group.name} items` : `Show ${group.name} items`}
                      aria-expanded={expanded}
                      onClick={() => toggle(group.id)}
                      className="ml-2 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                    >
                      <ChevronRightIcon
                        className={`h-3.5 w-3.5 transition-transform duration-200 ${
                          expanded ? 'rotate-90' : ''
                        }`}
                      />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      single ? onOpenLine(group.rows[0]!.id) : onOpenGroup(group.name, group.rows)
                    }
                    className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-4 text-left"
                  >
                    <ChannelIcon
                      channel={single ? group.rows[0]!.channel : null}
                      className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--foreground)]">
                        {group.name}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                        {single
                          ? channelLabel(group.rows[0]!.channel)
                          : `${group.rows.length} items · ${[
                              ...new Set(group.rows.map((r) => channelLabel(r.channel))),
                            ].join(', ')}`}
                      </span>
                    </span>
                    {single && <StatusPill status={group.rows[0]!.status} />}
                    <span className="w-24 text-right text-sm font-semibold tabular-nums text-[var(--foreground)]">
                      {usd0(group.amount)}
                    </span>
                  </button>
                </div>

                {!single && (
                  <Collapse open={expanded}>
                    <div className="ml-[3.25rem] border-l border-[var(--border)] pb-1.5">
                      {group.rows.map((line) => (
                        <PieceRow key={line.id} line={line} onOpen={onOpenLine} />
                      ))}
                    </div>
                  </Collapse>
                )}
              </div>
            );
          })}

          {/* Money that isn't part of a budget — one-offs, ticket money,
              anything imported. Its own section rather than hidden inside a
              budget it doesn't belong to. */}
          {loose.length > 0 && (
            <div>
              {groups.length > 0 && (
                <div className="flex items-baseline justify-between border-y border-[var(--border)] bg-[var(--muted)]/25 px-4 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Not part of a budget
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums text-[var(--muted-foreground)]">
                    {usd0(loose.reduce((t, r) => t + r.amount, 0))}
                  </span>
                </div>
              )}
              {loose.map((line) => (
                <div key={line.id} className="border-b border-[var(--border)] last:border-0">
                  <PieceRow line={line} onOpen={onOpenLine} indent={false} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One line inside a budget — the channel-level money the pacer actually reads. */
function PieceRow({
  line,
  onOpen,
  indent = true,
}: {
  line: BudgetLine;
  onOpen: (id: string) => void;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(line.id)}
      className={`flex w-full items-center gap-3 py-2 pr-4 text-left transition hover:bg-[var(--muted)]/40 ${
        indent ? 'pl-3' : 'px-4'
      }`}
    >
      <ChannelIcon
        channel={line.channel}
        className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-[var(--foreground)]">
          {line.label || channelLabel(line.channel)}
        </span>
        {/* The channel only when the name isn't already it — "Radio / Radio"
            is a row that says one thing twice. */}
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
      <span className="w-24 text-right text-sm tabular-nums text-[var(--foreground)]">
        {usd0(line.amount)}
      </span>
    </button>
  );
}
