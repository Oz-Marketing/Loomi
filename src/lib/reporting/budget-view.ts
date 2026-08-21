/**
 * Client-safe projection of the budget ledger, for Reporting.
 *
 * ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
 * The budget hub at /app/projects/budget is gated to MANAGEMENT_ROLES and shows
 * Oz's own numbers: `cost`, `revenue`, margin per line type, `knownRevenue`,
 * `uncostedAmount`, and `spendTarget` (= amount × markupSnapshot). Reporting is
 * a DIFFERENT audience — `requireReportingAccess` admits the `client` role, and
 * these pages are what dealers see.
 *
 * `spendTarget` deserves special mention because it does not look sensitive.
 * It is what actually reaches the platform; publishing it beside `amount`, what
 * the client pays, lets anyone divide one by the other and read Oz's markup off
 * the page. It is margin in a thin disguise, and it is omitted for that reason.
 *
 * So this is not "the hub summary with a couple of fields hidden". It is a
 * deliberate re-projection, and the test file asserts — by walking the whole
 * object graph — that no forbidden key survives it. If you add a field to
 * `BudgetSummary`, it does NOT appear here until someone decides it is the
 * client's to see.
 *
 * ── ONE SOURCE OF TRUTH ─────────────────────────────────────────────────────
 * The figures come from `budget.getAccountSummary`, the same function the hub
 * calls, rather than a parallel set of queries. A report that disagrees with
 * the hub about a client's budget is worse than no report, and two hand-written
 * rollups over the same ledger will drift the first time `COUNTED_STATUSES`
 * changes.
 *
 * ── NAMING ──────────────────────────────────────────────────────────────────
 * UI words, not model words (see the project's naming rule): the model's
 * "committed" is "Planned" here, an "agreement" is a "contract", and lines with
 * no month or channel yet are "unscheduled" rather than "pool".
 */
import * as budget from '@/lib/services/budget';
import { prisma } from '@/lib/prisma';
import { channelRegistry } from '@/lib/services/budget-channels';
import type { ChannelRegistry } from '@/lib/budget/channel-registry';

export interface BudgetChannelRow {
  channel: string;
  label: string;
  category: string;
  /** Client gross. Never the spend target. */
  amount: number;
  /** Null when no line in this channel has a recorded actual — see below. */
  actual: number | null;
  share: number;
}

export interface BudgetPeriodRow {
  period: string;
  label: string;
  amount: number;
  /**
   * NULL, NOT ZERO, when nothing has been recorded.
   *
   * A line can be `status: 'settled'` with `settledAt` set and `actualAmount`
   * still null — closed out without anyone recording what was spent. Reporting
   * that as $0 turns a missing number into a catastrophic underspend: a month
   * with $21k planned would show a $21k negative variance and read as though
   * the money was never used. Null lets the UI say "not recorded".
   */
  actual: number | null;
  /** Every line in the month has settled. */
  settled: boolean;
  /** At least one line carries a recorded actual. */
  actualRecorded: boolean;
}

export interface ClientBudgetView {
  accountKey: string;
  year: number;
  /** The contract figure for the year. Null when no contract carries one. */
  contractTotal: number | null;
  /** Σ every counted line, scheduled or not. */
  planned: number;
  /** Counted lines that have both a month and a channel. */
  scheduled: number;
  /** Counted lines still missing a month or a channel. */
  unscheduled: number;
  /** Σ recorded actuals. Null when the ledger holds no recorded actual at all. */
  spent: number | null;
  /** contractTotal − planned. Negative means planned beyond the contract. */
  unplanned: number | null;
  /** Planned exceeds the contract total. A flag, not an error. */
  overPlanned: boolean;
  byChannel: BudgetChannelRow[];
  byPeriod: BudgetPeriodRow[];
  /** Contract names and their share of this year — no fee breakdown. */
  contracts: { name: string; commitment: number | null }[];
  /**
   * Money on lines with no channel yet. Called out because it is the single
   * biggest reason a channel chart can disagree with the headline number, and
   * because the classification backlog in docs/budget-module.md keeps it
   * non-zero for real accounts.
   */
  unclassifiedAmount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Recorded actuals, keyed by period and by channel.
 *
 * `recorded` counts lines with a NON-NULL `actualAmount`, tracked separately
 * from `settled` because the two come apart in the real ledger: a line can be
 * closed with no figure ever entered.
 */
export interface ActualsIndex {
  byPeriod: Map<string, { actual: number; lines: number; settled: number; recorded: number }>;
  byChannel: Map<string, { actual: number; recorded: number }>;
  total: number;
  recordedLines: number;
}

export function indexActuals(
  rows: { period: string | null; channel: string | null; actualAmount: number | null; settled: boolean }[],
): ActualsIndex {
  const byPeriod = new Map<string, { actual: number; lines: number; settled: number; recorded: number }>();
  const byChannel = new Map<string, { actual: number; recorded: number }>();
  let total = 0;
  let recordedLines = 0;

  for (const r of rows) {
    const has = r.actualAmount != null;
    const amt = r.actualAmount ?? 0;
    if (has) recordedLines += 1;

    if (r.period) {
      const e = byPeriod.get(r.period) ?? { actual: 0, lines: 0, settled: 0, recorded: 0 };
      e.actual += amt;
      e.lines += 1;
      if (r.settled) e.settled += 1;
      if (has) e.recorded += 1;
      byPeriod.set(r.period, e);
    }
    if (r.channel) {
      const e = byChannel.get(r.channel) ?? { actual: 0, recorded: 0 };
      e.actual += amt;
      if (has) e.recorded += 1;
      byChannel.set(r.channel, e);
    }
    total += amt;
  }

  return { byPeriod, byChannel, total, recordedLines };
}

/**
 * Build the client-facing view. Pure, so the omission of margin fields is a
 * property the tests can assert rather than a convention someone has to
 * remember.
 */
export function toClientBudgetView(
  // Passed in rather than loaded here so this stays pure and synchronous —
  // which is the property the margin-leak tests rely on.
  ch: ChannelRegistry,
  accountKey: string,
  summary: budget.BudgetSummary,
  actuals: ActualsIndex,
): ClientBudgetView {
  const byChannel: BudgetChannelRow[] = summary.byChannel
    .map((c) => ({
      channel: c.channel,
      // `channelLabel` answers "Unassigned" for an unknown key, which is right
      // for a null channel but wrong for a real key the registry hasn't caught
      // up with — show the key itself so it's diagnosable rather than hidden.
      label: ch.category(c.channel) ? ch.label(c.channel) : c.channel,
      category: ch.category(c.channel) ?? 'Other',
      // `c.amount` only. `c.spendTarget` is deliberately NOT carried over —
      // see the file header.
      amount: round2(c.amount),
      actual: actuals.byChannel.get(c.channel)?.recorded
        ? round2(actuals.byChannel.get(c.channel)!.actual)
        : null,
      share: 0,
    }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));

  const channelTotal = byChannel.reduce((n, c) => n + c.amount, 0);
  for (const c of byChannel) c.share = channelTotal > 0 ? c.amount / channelTotal : 0;

  const byPeriod: BudgetPeriodRow[] = summary.byPeriod
    .map((p) => {
      const a = actuals.byPeriod.get(p.period);
      return {
        period: p.period,
        label: periodLabel(p.period),
        amount: round2(p.amount),
        actual: a && a.recorded > 0 ? round2(a.actual) : null,
        // Only claim a month is final when every line in it has settled;
        // otherwise a half-closed month reads as a real underspend.
        settled: !!a && a.lines > 0 && a.settled === a.lines,
        actualRecorded: !!a && a.recorded > 0,
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));

  return {
    accountKey,
    year: summary.year,
    contractTotal: summary.declaredTotal,
    planned: round2(summary.totalCommitted),
    scheduled: round2(summary.allocated),
    unscheduled: round2(summary.pool),
    spent: actuals.recordedLines > 0 ? round2(actuals.total) : null,
    unplanned: summary.unplanned == null ? null : round2(summary.unplanned),
    overPlanned: summary.overAllocated,
    byChannel,
    byPeriod,
    contracts: summary.agreements.map((a) => ({
      // A contract can be saved without a name; say so rather than rendering a
      // gap in a comma-joined list.
      name: a.name?.trim() || 'Unnamed contract',
      commitment: a.commitmentForYear ?? null,
    })),
    unclassifiedAmount: round2(summary.pool),
  };
}

/**
 * Actuals are not part of `BudgetSummary`, so they come from their own query.
 * Scoped to the same counted statuses the summary uses, or the two halves of
 * the report would be measuring different sets of lines.
 */
async function loadActuals(accountKey: string, year: number): Promise<ActualsIndex> {
  const rows = await prisma.budgetLine.findMany({
    where: {
      accountKey,
      year,
      archivedAt: null,
      status: { in: [...budget.COUNTED_STATUSES] },
    },
    select: { period: true, channel: true, actualAmount: true, settledAt: true },
  });

  return indexActuals(
    rows.map((r) => ({
      period: r.period,
      channel: r.channel,
      actualAmount: r.actualAmount == null ? null : budget.toNumber(r.actualAmount),
      settled: r.settledAt != null,
    })),
  );
}

export async function getReportingBudget(
  accountKey: string,
  year: number,
): Promise<ClientBudgetView> {
  const [summary, actuals, ch] = await Promise.all([
    budget.getAccountSummary(accountKey, year),
    loadActuals(accountKey, year),
    channelRegistry(),
  ]);
  return toClientBudgetView(ch, accountKey, summary, actuals);
}
