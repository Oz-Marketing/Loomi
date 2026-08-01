import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { accountMarginSetting } from '@/lib/ad-pacer/markup';
import { getGlobalDefaultMarkup } from '@/lib/services/markup';
import {
  channelCategory,
  channelLineType,
  channelPacerPlatform,
  channelsForPlatform,
  isBudgetChannel,
  type BudgetLineType,
  type PacerPlatform,
} from '@/lib/budget/channels';
import { isValidPeriod as isValidPeriodPure, periodOf, resolveYear } from '@/lib/budget/period';
import { splitFlight } from '@/lib/budget/flight';
import {
  commitmentForYear as termCommitmentForYear,
  monthsInYear,
  termMonths,
  termMonthsInYear,
} from '@/lib/budget/term';
import {
  accountTimeZone,
  adPlatformWhere,
  isPeriodWritable,
  monthState,
} from '@/lib/meta-ads-pacer';
import { writeAudit } from '@/lib/meta-ads-audit';
import { adContribution } from '@/lib/ad-pacer/helpers';
import { splitToCents } from '@/lib/budget/settlement';

/**
 * Budget service — the media-dollar ledger (see docs/budget-module.md).
 *
 * Every dollar is a BudgetLine. A line starts in the account's POOL (period and
 * channel null) and gets placed onto the two allocation axes as work is
 * planned. Placed lines on a paced channel roll up into the Ad Pacer's
 * per-period budget goals — one way, budget → pacer, never back.
 *
 * Account-scoped on `accountKey` like the rest of the app.
 *
 * Two invariants this module owns:
 *   1. `year` is always set, and agrees with `period` when `period` is set.
 *   2. `markupSnapshot` is resolved once at creation and never re-derived.
 *      Changing an account's markup must not rewrite historical targets.
 *
 * Over-allocation is a WARNING, never an error (docs §8.3): a hard block gets
 * routed around by inflating the declared total, which is worse than a visible
 * over-allocation state. Callers get `overAllocated` in the summary and decide
 * how loudly to say it.
 */

type Scope = string[] | null;

export function canAccess(scope: Scope, accountKey: string): boolean {
  return !scope || scope.length === 0 || scope.includes(accountKey);
}

/** Statuses that count as real money against the pool. */
export const COUNTED_STATUSES = ['committed', 'live', 'settled'] as const;
/** Everything except the ones excluded from all rollups. */
export const ACTIVE_STATUSES = ['planned', 'committed', 'live', 'settled'] as const;

const NOT_ARCHIVED = { archivedAt: null } as const;

// ── Money helpers ───────────────────────────────────────────────────────────
//
// Prisma returns Decimal; the API speaks plain numbers. Round-trip through
// Decimal for arithmetic (never float-sum currency), and only widen to `number`
// at the serialization boundary.

export function toNumber(d: Prisma.Decimal | null | undefined): number {
  return d == null ? 0 : d.toNumber();
}

function decimal(v: number | string): Prisma.Decimal {
  return new Prisma.Decimal(v);
}

function sumDecimal(values: (Prisma.Decimal | null)[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>(
    (acc, v) => (v == null ? acc : acc.plus(v)),
    new Prisma.Decimal(0),
  );
}

/** Reject NaN / Infinity / negative before it reaches a Decimal column. */
function assertAmount(amount: number, field = 'amount'): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${field} must be a non-negative finite number`);
  }
}

// Period helpers + the year/period invariant live in `budget/period` so they
// stay prisma-free (unit testable, importable from route handlers). Re-exported
// here because callers of the service shouldn't need to know that.
export { isValidPeriod, yearOfPeriod, periodOf } from '@/lib/budget/period';


// ── Markup ──────────────────────────────────────────────────────────────────

/**
 * The gross→spend factor to freeze onto a new line. Resolution order mirrors
 * the pacer's (docs §8.1 option a):
 *   1. BudgetPlan.defaultMarkup for the account+year
 *   2. Account.markup
 *   3. agency default (AppSetting)
 * An unconfigured markup resolves to 0, which surfaces as an obviously-broken
 * $0 spend target rather than a plausible wrong number — the same failure mode
 * `ad-pacer/markup.ts` is built around. Callers may override explicitly (a
 * radio line whose margin differs from the account's digital rate).
 */
export async function resolveMarkup(accountKey: string, year: number): Promise<number> {
  const [agreement, account, globalDefault] = await Promise.all([
    // The agreement covering this year wins, when one sets a markup. Most
    // specific first: a client can negotiate a rate for a term without it
    // becoming the account's permanent default.
    prisma.clientAgreement.findFirst({
      where: {
        accountKey,
        status: 'active',
        archivedAt: null,
        defaultMarkup: { not: null },
        startDate: { lte: new Date(Date.UTC(year, 11, 31)) },
        endDate: { gte: new Date(Date.UTC(year, 0, 1)) },
      },
      select: { defaultMarkup: true },
      orderBy: { startDate: 'desc' },
    }),
    prisma.account.findUnique({ where: { key: accountKey }, select: { markup: true } }),
    getGlobalDefaultMarkup(),
  ]);
  if (agreement?.defaultMarkup != null) {
    return accountMarginSetting(agreement.defaultMarkup, globalDefault);
  }
  return accountMarginSetting(account?.markup ?? null, globalDefault);
}

// ── Cost / revenue ──────────────────────────────────────────────────────────
//
// The one place cost is decided. Everything downstream — the DTO, the summary,
// any future P&L view — reads through here so the four line types can't drift
// apart across surfaces.

/**
 * What a line costs Oz, in the same dollars as `amount`.
 *
 * An explicitly stored cost always wins: for a resold service that number came
 * off a vendor invoice, and no percentage should override it. Otherwise:
 *   media  → amount × markup, the spend that reaches the platform
 *   fee    → 0, there is no external cost
 *   other  → null, genuinely unknown rather than assumed zero
 *
 * Null is meaningful and must stay null. Treating unknown cost as zero would
 * report 100% margin on every un-costed service line, which is the most
 * flattering possible lie.
 */
export function effectiveCost(line: {
  amount: number;
  markupSnapshot: number;
  lineType: string;
  cost: number | null;
}): number | null {
  if (line.cost != null) return line.cost;
  if (line.lineType === 'media') return line.amount * line.markupSnapshot;
  if (line.lineType === 'fee') return 0;
  return null;
}

/** amount − cost, or null when the cost isn't known yet. */
export function revenueOf(line: Parameters<typeof effectiveCost>[0]): number | null {
  const c = effectiveCost(line);
  return c == null ? null : line.amount - c;
}

/** Revenue as a share of what the client pays, or null when unknowable. */
export function marginOf(line: Parameters<typeof effectiveCost>[0]): number | null {
  const r = revenueOf(line);
  if (r == null || line.amount <= 0) return null;
  return r / line.amount;
}

// ── Serialization ───────────────────────────────────────────────────────────

type LineRow = Prisma.BudgetLineGetPayload<{
  include: {
    account: { select: { dealer: true } };
    spendAccount: { select: { dealer: true } };
    task: { select: { title: true } };
    initiative: { select: { name: true } };
  };
}>;

const LINE_INCLUDE = {
  account: { select: { dealer: true } },
  spendAccount: { select: { dealer: true } },
  task: { select: { title: true } },
  initiative: { select: { name: true } },
} as const;

export function serializeLine(l: LineRow) {
  const amount = toNumber(l.amount);
  const shape = {
    amount,
    markupSnapshot: l.markupSnapshot,
    lineType: l.lineType,
    cost: l.cost == null ? null : toNumber(l.cost),
  };
  return {
    id: l.id,
    accountKey: l.accountKey,
    accountDealer: l.account?.dealer ?? null,
    spendAccountKey: l.spendAccountKey,
    spendAccountDealer: l.spendAccount?.dealer ?? null,
    // True when this line is billed to one account but spends from another —
    // the co-op / group-buy case the hub badges.
    isCrossAccount: l.accountKey !== l.spendAccountKey,
    year: l.year,
    period: l.period,
    channel: l.channel,
    category: l.category,
    amount,
    markupSnapshot: l.markupSnapshot,
    lineType: l.lineType,
    // What this costs Oz. Explicit when someone entered it, derived otherwise.
    // Null means genuinely unknown — an un-costed service line, not free.
    cost: shape.cost,
    effectiveCost: effectiveCost(shape),
    revenue: revenueOf(shape),
    margin: marginOf(shape),
    // What should actually hit the platform. Derived, never stored — the
    // stored pair (amount, markupSnapshot) is the record. Media-only in
    // meaning; on a fee or service line it's an artefact, not a target.
    spendTarget: amount * l.markupSnapshot,
    source: l.source,
    status: l.status,
    bucket: l.bucket,
    initiativeId: l.initiativeId,
    initiativeName: l.initiative?.name ?? null,
    taskId: l.taskId,
    taskTitle: l.task?.title ?? null,
    agreementId: l.agreementId,
    batchId: l.batchId,
    // Flight membership, so a row can say what buy it's a month of.
    flightId: l.flightId,
    flightStart: l.flightStart ? l.flightStart.toISOString().slice(0, 10) : null,
    flightEnd: l.flightEnd ? l.flightEnd.toISOString().slice(0, 10) : null,
    externalId: l.externalId,
    linkedAssetType: l.linkedAssetType,
    linkedAssetId: l.linkedAssetId,
    actualAmount: l.actualAmount == null ? null : toNumber(l.actualAmount),
    settledAt: l.settledAt ? l.settledAt.toISOString() : null,
    label: l.label,
    notes: l.notes,
    isPool: l.period == null || l.channel == null,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

export type BudgetLineDTO = ReturnType<typeof serializeLine>;

// ── Events ──────────────────────────────────────────────────────────────────

export async function writeBudgetEvent(input: {
  lineId: string;
  action: string;
  summary: string;
  field?: string | null;
  fromValue?: string | null;
  toValue?: string | null;
  counterpartyLineId?: string | null;
  groupId?: string | null;
  authorUserId?: string | null;
}): Promise<void> {
  await prisma.budgetLineEvent.create({
    data: {
      lineId: input.lineId,
      action: input.action,
      summary: input.summary,
      field: input.field ?? null,
      fromValue: input.fromValue ?? null,
      toValue: input.toValue ?? null,
      counterpartyLineId: input.counterpartyLineId ?? null,
      groupId: input.groupId ?? null,
      authorUserId: input.authorUserId ?? null,
    },
  });
}

export async function listLineEvents(lineId: string) {
  const rows = await prisma.budgetLineEvent.findMany({
    where: { lineId },
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { id: true, name: true } } },
  });
  return rows.map((e) => ({
    id: e.id,
    action: e.action,
    field: e.field,
    fromValue: e.fromValue,
    toValue: e.toValue,
    summary: e.summary,
    counterpartyLineId: e.counterpartyLineId,
    groupId: e.groupId,
    author: e.author ?? null,
    createdAt: e.createdAt.toISOString(),
  }));
}

// ── Agreements ──────────────────────────────────────────────────────────────
//
// What the client signed up for. Budget lines draw down against it, and the
// gap between the two is the number the hub exists to show.

// The term arithmetic itself lives in `@/lib/budget/term`, Prisma-free so it
// can be unit-tested without a database. Re-exported here so callers have one
// import for everything budget-service.
export { monthsInYear, termMonths, termMonthsInYear } from '@/lib/budget/term';

/** `commitmentForYear` over a Prisma row, whose amount is a Decimal. */
export function commitmentForYear(
  agreement: { startDate: Date; endDate: Date; committedAmount: Prisma.Decimal | null },
  year: number,
): number | null {
  return termCommitmentForYear(
    {
      startDate: agreement.startDate,
      endDate: agreement.endDate,
      committedAmount: agreement.committedAmount == null ? null : toNumber(agreement.committedAmount),
    },
    year,
  );
}

export async function listAgreements(accountKey: string, opts: { year?: number } = {}) {
  const rows = await prisma.clientAgreement.findMany({
    where: {
      accountKey,
      archivedAt: null,
      // A year filter means "overlaps this year", not "starts in it" — a
      // Mar-to-Feb term is relevant to both years it touches.
      ...(opts.year != null
        ? {
            startDate: { lte: new Date(Date.UTC(opts.year, 11, 31)) },
            endDate: { gte: new Date(Date.UTC(opts.year, 0, 1)) },
          }
        : {}),
    },
    include: { fees: true },
    orderBy: { startDate: 'desc' },
  });
  return rows.map((a) => serializeAgreement(a, opts.year));
}

type AgreementRow = Prisma.ClientAgreementGetPayload<{ include: { fees: true } }>;

export function serializeAgreement(a: AgreementRow, year?: number) {
  return {
    id: a.id,
    accountKey: a.accountKey,
    name: a.name,
    startDate: a.startDate.toISOString().slice(0, 10),
    endDate: a.endDate.toISOString().slice(0, 10),
    committedAmount: a.committedAmount == null ? null : toNumber(a.committedAmount),
    status: a.status,
    defaultMarkup: a.defaultMarkup,
    notes: a.notes,
    termMonths: termMonths(a.startDate, a.endDate),
    monthsInYear: year == null ? null : monthsInYear(a.startDate, a.endDate, year),
    commitmentForYear: year == null ? null : commitmentForYear(a, year),
    monthlyFeeTotal: a.fees.reduce((sum, f) => sum + toNumber(f.monthlyAmount), 0),
    fees: a.fees.map((f) => ({
      id: f.id,
      channel: f.channel,
      monthlyAmount: toNumber(f.monthlyAmount),
      label: f.label,
    })),
  };
}

export type AgreementDTO = ReturnType<typeof serializeAgreement>;

export async function getAgreement(id: string) {
  const row = await prisma.clientAgreement.findUnique({ where: { id }, include: { fees: true } });
  return row ? serializeAgreement(row) : null;
}

export interface AgreementInput {
  accountKey: string;
  name: string;
  startDate: string;
  endDate: string;
  committedAmount?: number | null;
  status?: string;
  defaultMarkup?: number | null;
  notes?: string | null;
  fees?: { channel: string; monthlyAmount: number; label?: string | null }[];
}

function parseDate(iso: string, field: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`${field} must be YYYY-MM-DD`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export async function createAgreement(input: AgreementInput, userId: string | null = null) {
  const startDate = parseDate(input.startDate, 'startDate');
  const endDate = parseDate(input.endDate, 'endDate');
  if (endDate < startDate) throw new Error('endDate cannot be before startDate');
  if (input.committedAmount != null) assertAmount(input.committedAmount, 'committedAmount');
  for (const f of input.fees ?? []) {
    if (!isBudgetChannel(f.channel)) throw new Error(`Unknown budget channel "${f.channel}"`);
    assertAmount(f.monthlyAmount, 'monthlyAmount');
  }

  const row = await prisma.clientAgreement.create({
    data: {
      accountKey: input.accountKey,
      name: input.name.trim() || `${startDate.getUTCFullYear()} Agreement`,
      startDate,
      endDate,
      committedAmount: input.committedAmount == null ? null : decimal(input.committedAmount),
      status: input.status ?? 'active',
      defaultMarkup: input.defaultMarkup ?? null,
      notes: input.notes ?? null,
      createdByUserId: userId,
      fees: {
        create: (input.fees ?? []).map((f) => ({
          channel: f.channel,
          monthlyAmount: decimal(f.monthlyAmount),
          label: f.label ?? null,
        })),
      },
    },
    include: { fees: true },
  });
  return serializeAgreement(row);
}

export async function updateAgreement(
  id: string,
  input: Partial<AgreementInput>,
): Promise<AgreementDTO | null> {
  const existing = await prisma.clientAgreement.findUnique({ where: { id } });
  if (!existing) return null;

  const startDate = input.startDate ? parseDate(input.startDate, 'startDate') : existing.startDate;
  const endDate = input.endDate ? parseDate(input.endDate, 'endDate') : existing.endDate;
  if (endDate < startDate) throw new Error('endDate cannot be before startDate');
  if (input.committedAmount != null) assertAmount(input.committedAmount, 'committedAmount');

  // Fees are replaced wholesale when provided — a diff would need stable ids
  // through the UI for no real benefit at this size.
  if (input.fees) {
    for (const f of input.fees) {
      if (!isBudgetChannel(f.channel)) throw new Error(`Unknown budget channel "${f.channel}"`);
      assertAmount(f.monthlyAmount, 'monthlyAmount');
    }
    await prisma.agreementFee.deleteMany({ where: { agreementId: id } });
  }

  const row = await prisma.clientAgreement.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      startDate,
      endDate,
      ...(input.committedAmount !== undefined
        ? { committedAmount: input.committedAmount == null ? null : decimal(input.committedAmount) }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.defaultMarkup !== undefined ? { defaultMarkup: input.defaultMarkup } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.fees
        ? {
            fees: {
              create: input.fees.map((f) => ({
                channel: f.channel,
                monthlyAmount: decimal(f.monthlyAmount),
                label: f.label ?? null,
              })),
            },
          }
        : {}),
    },
    include: { fees: true },
  });
  return serializeAgreement(row);
}

export async function archiveAgreement(id: string): Promise<boolean> {
  const existing = await prisma.clientAgreement.findUnique({ where: { id } });
  if (!existing || existing.archivedAt) return false;
  // Lines keep their money and simply lose the link (onDelete: SetNull is for
  // deletes; archiving leaves the FK intact so history stays readable).
  await prisma.clientAgreement.update({
    where: { id },
    data: { archivedAt: new Date(), status: 'cancelled' },
  });
  return true;
}

// ── Lines ───────────────────────────────────────────────────────────────────

export interface CreateLineInput {
  accountKey: string;
  /** Defaults to accountKey — the ordinary same-account case. */
  spendAccountKey?: string | null;
  year?: number;
  period?: string | null;
  channel?: string | null;
  amount: number;
  /** Override the resolved markup (a non-digital line with its own margin). */
  markup?: number | null;
  source?: string;
  status?: string;
  bucket?: string;
  /** The agreement this line draws against, when there is one. */
  agreementId?: string | null;
  /** Defaults from the channel; set explicitly when a line behaves unlike it. */
  lineType?: BudgetLineType;
  /** What it costs Oz. Required for a service/production line to show margin. */
  cost?: number | null;
  initiativeId?: string | null;
  taskId?: string | null;
  batchId?: string | null;
  /** Source-system identity, e.g. "ozreports:account_budgets:8842". */
  externalId?: string | null;
  /** Set by `createFlight` — one id shared by every month of a buy. */
  flightId?: string | null;
  flightStart?: Date | null;
  flightEnd?: Date | null;
  label?: string | null;
  notes?: string | null;
}

/**
 * The bucket a line's money lands in on the pacer. Retainer money is the
 * client's standing budget (base); anything requested on top is an add-on
 * (added). An explicit bucket always wins — reps need somewhere to put the
 * exception, which is why this is a stored column and not a derived value.
 */
export function defaultBucket(source: string): 'base' | 'added' {
  return source === 'retainer' ? 'base' : 'added';
}

export async function createLine(
  input: CreateLineInput,
  userId: string | null,
): Promise<BudgetLineDTO> {
  const [line] = await createLines([input], userId);
  return line!;
}

/**
 * Create a batch of lines as one action. Every line gets the SAME batchId
 * (oz-reports' bulk_entry_id) so a 12-store × 6-month submission can later be
 * edited or released as a unit, and one groupId ties their creation events.
 */
export async function createLines(
  inputs: CreateLineInput[],
  userId: string | null,
  opts: { batchId?: string; groupId?: string } = {},
): Promise<BudgetLineDTO[]> {
  if (inputs.length === 0) return [];

  const batchId = opts.batchId ?? crypto.randomUUID();
  const groupId = opts.groupId ?? crypto.randomUUID();

  // Resolve markup once per (account, year) rather than per line — a 12-month
  // retainer fan-out would otherwise make 36 queries for one answer.
  const markupCache = new Map<string, number>();
  const resolved: {
    input: CreateLineInput;
    year: number;
    markup: number;
    channel: string | null;
  }[] = [];

  for (const input of inputs) {
    assertAmount(input.amount);
    const year = resolveYear(input.period, input.year);
    const channel = input.channel ?? null;
    if (channel != null && !isBudgetChannel(channel)) {
      throw new Error(`Unknown budget channel "${channel}"`);
    }
    let markup = input.markup ?? null;
    if (markup == null) {
      const cacheKey = `${input.accountKey}:${year}`;
      if (!markupCache.has(cacheKey)) {
        markupCache.set(cacheKey, await resolveMarkup(input.accountKey, year));
      }
      markup = markupCache.get(cacheKey)!;
    }
    resolved.push({ input, year, markup, channel });
  }

  const created: BudgetLineDTO[] = [];
  for (const { input, year, markup, channel } of resolved) {
    const source = input.source ?? 'adhoc';
    const row = await prisma.budgetLine.create({
      data: {
        accountKey: input.accountKey,
        spendAccountKey: input.spendAccountKey || input.accountKey,
        year,
        period: input.period ?? null,
        channel,
        category: channelCategory(channel),
        amount: decimal(input.amount),
        markupSnapshot: markup,
        source,
        status: input.status ?? 'planned',
        bucket: input.bucket ?? defaultBucket(source),
        lineType: input.lineType ?? channelLineType(channel),
        cost: input.cost == null ? null : decimal(input.cost),
        agreementId: input.agreementId ?? null,
        initiativeId: input.initiativeId ?? null,
        taskId: input.taskId ?? null,
        batchId: input.batchId ?? batchId,
        externalId: input.externalId ?? null,
        flightId: input.flightId ?? null,
        flightStart: input.flightStart ?? null,
        flightEnd: input.flightEnd ?? null,
        label: input.label ?? null,
        notes: input.notes ?? null,
        createdByUserId: userId,
      },
      include: LINE_INCLUDE,
    });
    await writeBudgetEvent({
      lineId: row.id,
      action: 'created',
      summary: describeCreate(row),
      groupId,
      authorUserId: userId,
    });
    created.push(serializeLine(row));
  }

  await syncPacerForPlacements(
    created.map((l) => ({
      spendAccountKey: l.spendAccountKey,
      period: l.period,
      channel: l.channel,
    })),
    userId,
  );
  return created;
}

function describeCreate(row: { amount: Prisma.Decimal; period: string | null; channel: string | null }): string {
  const amt = money(toNumber(row.amount));
  const where =
    row.period && row.channel
      ? `${row.channel} · ${row.period}`
      : row.channel
        ? `${row.channel} · unscheduled`
        : row.period
          ? `${row.period} · unassigned channel`
          : 'pool';
  return `${amt} added (${where})`;
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function getLine(id: string): Promise<BudgetLineDTO | null> {
  const row = await prisma.budgetLine.findUnique({ where: { id }, include: LINE_INCLUDE });
  return row ? serializeLine(row) : null;
}

export async function listLines(opts: {
  scope: Scope;
  accountKey?: string | null;
  year?: number | null;
  period?: string | null;
  channel?: string | null;
  taskId?: string | null;
  initiativeId?: string | null;
  batchId?: string | null;
  /** Pool-only (`true`) or placed-only (`false`); omit for both. */
  poolOnly?: boolean;
  includeArchived?: boolean;
}): Promise<BudgetLineDTO[]> {
  const where: Prisma.BudgetLineWhereInput = {
    ...(opts.includeArchived ? {} : NOT_ARCHIVED),
    ...(opts.scope && opts.scope.length > 0 ? { accountKey: { in: opts.scope } } : {}),
    ...(opts.accountKey ? { accountKey: opts.accountKey } : {}),
    ...(opts.year != null ? { year: opts.year } : {}),
    ...(opts.period ? { period: opts.period } : {}),
    ...(opts.channel ? { channel: opts.channel } : {}),
    ...(opts.taskId ? { taskId: opts.taskId } : {}),
    ...(opts.initiativeId ? { initiativeId: opts.initiativeId } : {}),
    ...(opts.batchId ? { batchId: opts.batchId } : {}),
    ...(opts.poolOnly === true ? { OR: [{ period: null }, { channel: null }] } : {}),
    ...(opts.poolOnly === false ? { period: { not: null }, channel: { not: null } } : {}),
  };
  const rows = await prisma.budgetLine.findMany({
    where,
    include: LINE_INCLUDE,
    orderBy: [{ period: 'asc' }, { channel: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(serializeLine);
}

export interface UpdateLineInput {
  amount?: number;
  period?: string | null;
  channel?: string | null;
  status?: string;
  bucket?: string;
  label?: string | null;
  notes?: string | null;
  spendAccountKey?: string;
}

export async function updateLine(
  id: string,
  input: UpdateLineInput,
  userId: string | null,
): Promise<BudgetLineDTO | null> {
  const existing = await prisma.budgetLine.findUnique({ where: { id } });
  if (!existing) return null;

  const data: Prisma.BudgetLineUpdateInput = {};
  const events: { field: string; from: string; to: string; summary: string }[] = [];

  if (input.amount != null && input.amount !== toNumber(existing.amount)) {
    assertAmount(input.amount);
    data.amount = decimal(input.amount);
    events.push({
      field: 'amount',
      from: String(toNumber(existing.amount)),
      to: String(input.amount),
      summary: `Amount ${money(toNumber(existing.amount))} → ${money(input.amount)}`,
    });
  }

  // Placement changes have to keep the year invariant, so period and channel
  // are resolved together with the (possibly unchanged) other half.
  const nextPeriod = input.period !== undefined ? input.period : existing.period;
  if (input.period !== undefined && input.period !== existing.period) {
    data.period = input.period;
    data.year = resolveYear(input.period, input.period ? undefined : existing.year);
    events.push({
      field: 'period',
      from: existing.period ?? '',
      to: input.period ?? '',
      summary: `Month ${existing.period ?? 'pool'} → ${input.period ?? 'pool'}`,
    });
  }
  if (input.channel !== undefined && input.channel !== existing.channel) {
    if (input.channel != null && !isBudgetChannel(input.channel)) {
      throw new Error(`Unknown budget channel "${input.channel}"`);
    }
    data.channel = input.channel;
    data.category = channelCategory(input.channel);
    events.push({
      field: 'channel',
      from: existing.channel ?? '',
      to: input.channel ?? '',
      summary: `Channel ${existing.channel ?? 'unassigned'} → ${input.channel ?? 'unassigned'}`,
    });
  }
  if (input.status && input.status !== existing.status) {
    data.status = input.status;
    // Settling stamps the timestamp; un-settling clears it so a corrected line
    // doesn't keep a stale settled date.
    if (input.status === 'settled') data.settledAt = new Date();
    else if (existing.status === 'settled') data.settledAt = null;
    events.push({
      field: 'status',
      from: existing.status,
      to: input.status,
      summary: `Status ${existing.status} → ${input.status}`,
    });
  }
  if (input.bucket && input.bucket !== existing.bucket) {
    data.bucket = input.bucket;
    events.push({
      field: 'bucket',
      from: existing.bucket,
      to: input.bucket,
      summary: `Pacer bucket ${existing.bucket} → ${input.bucket}`,
    });
  }
  if (input.spendAccountKey && input.spendAccountKey !== existing.spendAccountKey) {
    data.spendAccount = { connect: { key: input.spendAccountKey } };
    events.push({
      field: 'spendAccountKey',
      from: existing.spendAccountKey,
      to: input.spendAccountKey,
      summary: `Spending from ${existing.spendAccountKey} → ${input.spendAccountKey}`,
    });
  }
  if (input.label !== undefined) data.label = input.label;
  if (input.notes !== undefined) data.notes = input.notes;

  if (Object.keys(data).length === 0) {
    const row = await prisma.budgetLine.findUnique({ where: { id }, include: LINE_INCLUDE });
    return row ? serializeLine(row) : null;
  }

  const row = await prisma.budgetLine.update({ where: { id }, data, include: LINE_INCLUDE });

  const groupId = crypto.randomUUID();
  for (const e of events) {
    await writeBudgetEvent({
      lineId: id,
      action: e.field === 'status' ? statusAction(input.status!) : 'edited',
      field: e.field,
      fromValue: e.from,
      toValue: e.to,
      summary: e.summary,
      groupId,
      authorUserId: userId,
    });
  }
  // A placement edit that fully placed the line is worth its own plain-language
  // line in the feed — it's the moment pool money became a real commitment.
  if (nextPeriod && row.channel && (input.period !== undefined || input.channel !== undefined)) {
    await writeBudgetEvent({
      lineId: id,
      action: 'allocated',
      summary: `Placed on ${row.channel} · ${nextPeriod}`,
      groupId,
      authorUserId: userId,
    });
  }

  // BOTH placements: the one the line moved out of and the one it moved into.
  // Syncing only the new one would leave the old month still counting money
  // that isn't there any more.
  await syncPacerForPlacements(
    [
      { spendAccountKey: existing.spendAccountKey, period: existing.period, channel: existing.channel },
      { spendAccountKey: row.spendAccountKey, period: row.period, channel: row.channel },
    ],
    userId,
  );
  return serializeLine(row);
}

function statusAction(status: string): string {
  if (status === 'committed') return 'committed';
  if (status === 'settled') return 'settled';
  if (status === 'canceled') return 'canceled';
  return 'edited';
}

/**
 * Split money off a pool (or any) line onto a new, more-specific one — the
 * oz-reports pool→category→channel→month progression, generalized.
 *
 * The source line is decremented rather than deleted, so partial allocation is
 * the normal case and the remainder stays in the pool. Both sides get an event
 * tied by groupId, each pointing at the other via counterpartyLineId, which is
 * what makes the trail followable in either direction.
 */
export async function allocateFromLine(
  sourceId: string,
  input: { amount: number; period?: string | null; channel?: string | null; taskId?: string | null; initiativeId?: string | null; label?: string | null; notes?: string | null },
  userId: string | null,
): Promise<{ source: BudgetLineDTO; allocated: BudgetLineDTO } | null> {
  assertAmount(input.amount);
  const src = await prisma.budgetLine.findUnique({ where: { id: sourceId } });
  if (!src) return null;

  const srcAmount = toNumber(src.amount);
  if (input.amount > srcAmount) {
    throw new Error(
      `Cannot allocate ${money(input.amount)} — the line only holds ${money(srcAmount)}`,
    );
  }
  const channel = input.channel ?? src.channel;
  if (channel != null && !isBudgetChannel(channel)) {
    throw new Error(`Unknown budget channel "${channel}"`);
  }
  const period = input.period ?? src.period;
  const year = resolveYear(period, period ? undefined : src.year);
  const groupId = crypto.randomUUID();
  const remainder = srcAmount - input.amount;

  // Carry the source's frozen markup onto the child. The money didn't change
  // hands or dates — re-resolving here would let a markup change leak into an
  // old line by the back door.
  const allocatedRow = await prisma.budgetLine.create({
    data: {
      accountKey: src.accountKey,
      spendAccountKey: src.spendAccountKey,
      year,
      period,
      channel,
      category: channelCategory(channel),
      amount: decimal(input.amount),
      markupSnapshot: src.markupSnapshot,
      source: src.source,
      status: src.status === 'planned' ? 'planned' : 'committed',
      bucket: src.bucket,
      // A split inherits what kind of money it is; changing channel can change
      // it, so re-derive when the child lands somewhere different.
      lineType: channel === src.channel ? src.lineType : channelLineType(channel),
      initiativeId: input.initiativeId ?? src.initiativeId,
      taskId: input.taskId ?? src.taskId,
      batchId: src.batchId,
      label: input.label ?? src.label,
      notes: input.notes ?? null,
      createdByUserId: userId,
    },
    include: LINE_INCLUDE,
  });

  // A fully-drained source is archived, not deleted — its event history is the
  // audit trail for where the money went.
  const sourceRow = await prisma.budgetLine.update({
    where: { id: sourceId },
    data: {
      amount: decimal(remainder),
      ...(remainder === 0 ? { archivedAt: new Date(), status: 'canceled' } : {}),
    },
    include: LINE_INCLUDE,
  });

  const dest = channel && period ? `${channel} · ${period}` : (channel ?? period ?? 'pool');
  await writeBudgetEvent({
    lineId: sourceId,
    action: 'allocated',
    summary: `${money(input.amount)} allocated out to ${dest}${remainder === 0 ? ' (fully drained)' : `, ${money(remainder)} left`}`,
    counterpartyLineId: allocatedRow.id,
    groupId,
    authorUserId: userId,
  });
  await writeBudgetEvent({
    lineId: allocatedRow.id,
    action: 'created',
    summary: `${money(input.amount)} allocated from pool to ${dest}`,
    counterpartyLineId: sourceId,
    groupId,
    authorUserId: userId,
  });

  // The source's placement changes total too (it's lighter now), so both ends
  // of the split re-sync.
  await syncPacerForPlacements(
    [
      { spendAccountKey: sourceRow.spendAccountKey, period: sourceRow.period, channel: sourceRow.channel },
      { spendAccountKey: allocatedRow.spendAccountKey, period: allocatedRow.period, channel: allocatedRow.channel },
    ],
    userId,
  );

  return { source: serializeLine(sourceRow), allocated: serializeLine(allocatedRow) };
}

/**
 * Release a line's money back to the account's pool: archive the line and mint
 * an unplaced one for the same amount. The reverse of allocateFromLine, and the
 * reason cancellation doesn't just make money vanish from the year's totals.
 */
export async function returnToPool(
  id: string,
  userId: string | null,
  reason?: string | null,
): Promise<BudgetLineDTO | null> {
  const src = await prisma.budgetLine.findUnique({ where: { id } });
  if (!src || src.archivedAt) return null;
  if (src.status === 'settled') {
    throw new Error('A settled line is closed — reopen it before returning money to the pool.');
  }

  const groupId = crypto.randomUUID();
  const amount = toNumber(src.amount);

  const poolRow = await prisma.budgetLine.create({
    data: {
      accountKey: src.accountKey,
      spendAccountKey: src.spendAccountKey,
      year: src.year,
      period: null,
      channel: null,
      category: null,
      amount: src.amount,
      markupSnapshot: src.markupSnapshot,
      source: 'pool',
      status: 'committed',
      bucket: src.bucket,
      lineType: src.lineType,
      batchId: src.batchId,
      label: src.label,
      notes: reason ?? null,
      createdByUserId: userId,
    },
    include: LINE_INCLUDE,
  });

  await prisma.budgetLine.update({
    where: { id },
    data: { status: 'canceled', archivedAt: new Date() },
  });

  await writeBudgetEvent({
    lineId: id,
    action: 'returned',
    summary: `${money(amount)} returned to pool${reason ? ` — ${reason}` : ''}`,
    counterpartyLineId: poolRow.id,
    groupId,
    authorUserId: userId,
  });
  await writeBudgetEvent({
    lineId: poolRow.id,
    action: 'created',
    summary: `${money(amount)} returned to pool from ${src.channel ?? 'unassigned'} · ${src.period ?? 'unscheduled'}`,
    counterpartyLineId: id,
    groupId,
    authorUserId: userId,
  });

  // The money left a placed month for the pool, so that month's total drops.
  await syncPacerForPlacements(
    [{ spendAccountKey: src.spendAccountKey, period: src.period, channel: src.channel }],
    userId,
  );

  return serializeLine(poolRow);
}

export async function archiveLine(id: string, userId: string | null): Promise<boolean> {
  const existing = await prisma.budgetLine.findUnique({ where: { id } });
  if (!existing || existing.archivedAt) return false;
  await prisma.budgetLine.update({
    where: { id },
    data: { archivedAt: new Date(), status: 'canceled' },
  });
  await writeBudgetEvent({
    lineId: id,
    action: 'canceled',
    summary: `${money(toNumber(existing.amount))} line canceled`,
    authorUserId: userId,
  });
  await syncPacerForPlacements(
    [{ spendAccountKey: existing.spendAccountKey, period: existing.period, channel: existing.channel }],
    userId,
  );
  return true;
}

// ── Rollups ─────────────────────────────────────────────────────────────────

export interface BudgetSummary {
  accountKey: string;
  year: number;
  /** BudgetPlan.declaredTotal, or null when the account has no formal plan. */
  declaredTotal: number | null;
  /** Σ of every active agreement's monthly fees. Null when there are none. */
  monthlyRetainer: number | null;
  agreements: AgreementDTO[];
  /** Σ every counted line — placed and pooled. What the year actually holds. */
  totalCommitted: number;
  /** Σ counted lines that are fully placed (period AND channel set). */
  allocated: number;
  /** Σ counted lines still missing a period or a channel. */
  pool: number;
  /** declaredTotal − totalCommitted. Negative = over-allocated. Null without a plan. */
  unplanned: number | null;
  /**
   * True when committed money exceeds the declared total. A WARNING, not an
   * error (docs §8.3) — the hub shows it, nothing blocks on it.
   */
  overAllocated: boolean;
  byChannel: { channel: string; amount: number; spendTarget: number }[];
  byPeriod: { period: string; amount: number; spendTarget: number }[];
  /**
   * The split Oz Reports could never produce: how much of the year is media,
   * fees, resold services and production. `costKnown` is false for a type with
   * any un-costed line, so the UI can say "at least $X" rather than implying a
   * margin it can't actually compute.
   */
  byLineType: {
    lineType: string;
    amount: number;
    cost: number;
    revenue: number;
    costKnown: boolean;
    lines: number;
  }[];
  /** Σ revenue across types whose cost is fully known. */
  knownRevenue: number;
  /** Client dollars sitting on lines with no cost yet — margin is unknowable. */
  uncostedAmount: number;
}

/**
 * The account/year rollup the hub and the intake form both render. One query
 * over the lines plus the plan row; everything else is arithmetic here rather
 * than groupBy round-trips, because a year is at most a few hundred lines.
 */
export async function getAccountSummary(
  accountKey: string,
  year: number,
): Promise<BudgetSummary> {
  const [agreements, lines] = await Promise.all([
    prisma.clientAgreement.findMany({
      where: {
        accountKey,
        status: 'active',
        archivedAt: null,
        startDate: { lte: new Date(Date.UTC(year, 11, 31)) },
        endDate: { gte: new Date(Date.UTC(year, 0, 1)) },
      },
      include: { fees: true },
    }),
    prisma.budgetLine.findMany({
      where: {
        accountKey,
        year,
        ...NOT_ARCHIVED,
        status: { in: [...COUNTED_STATUSES] },
      },
      select: {
        amount: true,
        markupSnapshot: true,
        period: true,
        channel: true,
        lineType: true,
        cost: true,
      },
    }),
  ]);

  const placed = lines.filter((l) => l.period != null && l.channel != null);
  const pooled = lines.filter((l) => l.period == null || l.channel == null);

  const allocated = toNumber(sumDecimal(placed.map((l) => l.amount)));
  const pool = toNumber(sumDecimal(pooled.map((l) => l.amount)));
  const totalCommitted = allocated + pool;
  // The year's target is the sum of every active agreement's share of it. Null
  // when no agreement carries a committed figure — the hub then shows no target
  // rather than implying one derived from the lines themselves.
  const shares = agreements
    .map((a) => commitmentForYear(a, year))
    .filter((v): v is number => v != null);
  const declaredTotal = shares.length > 0 ? shares.reduce((a, b) => a + b, 0) : null;
  const monthlyFeeTotal = agreements.reduce(
    (sum, a) => sum + a.fees.reduce((s, f) => s + toNumber(f.monthlyAmount), 0),
    0,
  );

  const byChannelMap = new Map<string, { amount: number; spendTarget: number }>();
  const byPeriodMap = new Map<string, { amount: number; spendTarget: number }>();
  for (const l of placed) {
    const amt = toNumber(l.amount);
    const spend = amt * l.markupSnapshot;
    const ch = byChannelMap.get(l.channel!) ?? { amount: 0, spendTarget: 0 };
    byChannelMap.set(l.channel!, { amount: ch.amount + amt, spendTarget: ch.spendTarget + spend });
    const pd = byPeriodMap.get(l.period!) ?? { amount: 0, spendTarget: 0 };
    byPeriodMap.set(l.period!, { amount: pd.amount + amt, spendTarget: pd.spendTarget + spend });
  }

  // Line-type rollup across EVERY counted line, placed or pooled — a fee sitting
  // in the pool is still fee revenue.
  const typeAgg = new Map<
    string,
    { amount: number; cost: number; revenue: number; costKnown: boolean; lines: number }
  >();
  let uncostedAmount = 0;
  for (const l of lines) {
    const amt = toNumber(l.amount);
    const shape = {
      amount: amt,
      markupSnapshot: l.markupSnapshot,
      lineType: l.lineType,
      cost: l.cost == null ? null : toNumber(l.cost),
    };
    const c = effectiveCost(shape);
    const entry = typeAgg.get(l.lineType) ?? {
      amount: 0, cost: 0, revenue: 0, costKnown: true, lines: 0,
    };
    entry.amount += amt;
    entry.lines += 1;
    if (c == null) {
      // One un-costed line makes the whole type's margin a guess. Say so rather
      // than quietly reporting the costed subset as if it were everything.
      entry.costKnown = false;
      uncostedAmount += amt;
    } else {
      entry.cost += c;
      entry.revenue += amt - c;
    }
    typeAgg.set(l.lineType, entry);
  }
  const byLineType = [...typeAgg.entries()]
    .map(([lineType, v]) => ({ lineType, ...v }))
    .sort((a, b) => b.amount - a.amount);
  const knownRevenue = byLineType
    .filter((t) => t.costKnown)
    .reduce((sum, t) => sum + t.revenue, 0);

  return {
    accountKey,
    year,
    declaredTotal,
    monthlyRetainer: monthlyFeeTotal > 0 ? monthlyFeeTotal : null,
    agreements: agreements.map((a) => serializeAgreement(a, year)),
    totalCommitted,
    allocated,
    pool,
    unplanned: declaredTotal == null ? null : declaredTotal - totalCommitted,
    overAllocated: declaredTotal != null && totalCommitted > declaredTotal,
    byChannel: [...byChannelMap.entries()]
      .map(([channel, v]) => ({ channel, ...v }))
      .sort((a, b) => b.amount - a.amount),
    byPeriod: [...byPeriodMap.entries()]
      .map(([period, v]) => ({ period, ...v }))
      .sort((a, b) => a.period.localeCompare(b.period)),
    byLineType,
    knownRevenue,
    uncostedAmount,
  };
}

/**
 * What one pacer platform should see as its period budget goals, in client
 * gross dollars. This is the read half of the Phase 3 binding — the write half
 * (into MetaAdsPacerPeriodBudget) lands with that phase; nothing calls it to
 * mutate the pacer yet.
 *
 * Keyed off spendAccountKey, not accountKey: a co-op line billed to a group but
 * spending from a rooftop paces on the ROOFTOP's plan.
 */
export async function getPacerBudgetGoals(
  spendAccountKey: string,
  period: string,
  platform: PacerPlatform,
): Promise<{ base: number; added: number; lineCount: number }> {
  if (!isValidPeriodPure(period)) throw new Error(`Invalid period "${period}"`);
  const lines = await prisma.budgetLine.findMany({
    where: {
      spendAccountKey,
      period,
      channel: { in: channelsForPlatform(platform) },
      status: { in: ['committed', 'live'] },
      ...NOT_ARCHIVED,
    },
    select: { amount: true, bucket: true },
  });
  const base = toNumber(sumDecimal(lines.filter((l) => l.bucket === 'base').map((l) => l.amount)));
  const added = toNumber(sumDecimal(lines.filter((l) => l.bucket !== 'base').map((l) => l.amount)));
  return { base, added, lineCount: lines.length };
}

/**
 * Stamp budget lines for an agreement's recurring fees across a year.
 *
 * Replaces the old single-channel retainer generator. A client typically pays
 * several distinct fees on different channels — management, managed service,
 * contribution — and collapsing them into one number lost the breakdown the
 * P&L needs.
 *
 * Only generates months the term actually covers, so a Mar–Feb agreement puts
 * nothing in January or February of its first year. Skips any (channel, month)
 * that already has a fee line from this agreement, so re-running never doubles
 * a client's fees.
 */
export async function generateAgreementFeeLines(
  agreementId: string,
  year: number,
  userId: string | null = null,
): Promise<BudgetLineDTO[]> {
  const agreement = await prisma.clientAgreement.findUnique({
    where: { id: agreementId },
    include: { fees: true },
  });
  if (!agreement) throw new Error('Agreement not found');
  if (agreement.fees.length === 0) {
    throw new Error('This agreement has no recurring fees to lay out.');
  }

  const months = termMonthsInYear(agreement.startDate, agreement.endDate, year);
  if (months.length === 0) return [];

  const existing = await prisma.budgetLine.findMany({
    where: { agreementId, year, source: 'retainer', ...NOT_ARCHIVED },
    select: { period: true, channel: true },
  });
  const taken = new Set(existing.map((e) => `${e.channel}|${e.period}`));

  const inputs: CreateLineInput[] = [];
  for (const fee of agreement.fees) {
    for (const m of months) {
      const period = periodOf(year, m);
      if (taken.has(`${fee.channel}|${period}`)) continue;
      inputs.push({
        accountKey: agreement.accountKey,
        year,
        period,
        channel: fee.channel,
        amount: toNumber(fee.monthlyAmount),
        source: 'retainer',
        status: 'committed',
        agreementId,
        label: fee.label ?? 'Managed Marketing Service',
      });
    }
  }

  return createLines(inputs, userId);
}

// ── Flights (Phase C) ───────────────────────────────────────────────────────
//
// A media buy is one commercial fact — one insertion order, one total, one date
// range — but the ledger is at month grain. A flight is the authoring concept
// above the ledger: enter the buy once, and it lays out the months, split by
// DAYS (see budget/flight.ts), summing to the total exactly.
//
// Month grain stays the unit deliberately. Every rollup, the pacer binding and
// settlement all assume a line sits in exactly one month, and "half-settled"
// has no meaning. So a flight is N linked rows, not one row with a range.

export interface FlightInput {
  accountKey: string;
  spendAccountKey?: string | null;
  channel: string;
  /** ISO `YYYY-MM-DD`, inclusive at both ends. */
  startDate: string;
  endDate: string;
  /** The whole buy. Individual months are derived, never entered. */
  amount: number;
  markup?: number | null;
  status?: string;
  bucket?: string;
  source?: string;
  lineType?: BudgetLineType;
  agreementId?: string | null;
  initiativeId?: string | null;
  taskId?: string | null;
  label?: string | null;
  notes?: string | null;
}

/** The months of a flight, with their shares, WITHOUT writing anything. */
export function previewFlight(startDate: string, endDate: string, amount: number) {
  const start = parseDate(startDate, 'startDate');
  const end = parseDate(endDate, 'endDate');
  if (end < start) throw new Error('The flight ends before it starts');
  return splitFlight(start, end, amount);
}

export async function createFlight(
  input: FlightInput,
  userId: string | null = null,
): Promise<BudgetLineDTO[]> {
  const start = parseDate(input.startDate, 'startDate');
  const end = parseDate(input.endDate, 'endDate');
  if (end < start) throw new Error('The flight ends before it starts');
  if (!isBudgetChannel(input.channel)) throw new Error(`Unknown budget channel "${input.channel}"`);
  assertAmount(input.amount);

  // A flight crossing the new year is legitimate — a December-into-January buy
  // is ordinary — and each month's line simply carries its OWN year, which is
  // what `resolveYear` already enforces per row.
  const parts = splitFlight(start, end, input.amount);
  if (parts.length === 0) throw new Error('That range covers no months');

  const flightId = crypto.randomUUID();
  const inputs: CreateLineInput[] = parts.map((part) => ({
    accountKey: input.accountKey,
    spendAccountKey: input.spendAccountKey ?? null,
    period: part.period,
    channel: input.channel,
    amount: part.amount,
    markup: input.markup ?? null,
    status: input.status ?? 'committed',
    bucket: input.bucket,
    source: input.source ?? 'adhoc',
    lineType: input.lineType,
    agreementId: input.agreementId ?? null,
    initiativeId: input.initiativeId ?? null,
    taskId: input.taskId ?? null,
    label: input.label ?? null,
    notes: input.notes ?? null,
    flightId,
    flightStart: start,
    flightEnd: end,
  }));

  return createLines(inputs, userId, { groupId: flightId });
}

export interface FlightDTO {
  flightId: string;
  accountKey: string;
  channel: string | null;
  startDate: string;
  endDate: string;
  /** Sum of the months, i.e. what the buy is currently worth. */
  amount: number;
  label: string | null;
  months: { id: string; period: string | null; amount: number; status: string }[];
  /** Months already closed out. These are never re-split. */
  settledMonths: number;
}

export async function getFlight(flightId: string): Promise<FlightDTO | null> {
  const lines = await prisma.budgetLine.findMany({
    where: { flightId, ...NOT_ARCHIVED },
    orderBy: { period: 'asc' },
  });
  if (lines.length === 0) return null;

  const first = lines[0]!;
  return {
    flightId,
    accountKey: first.accountKey,
    channel: first.channel,
    startDate: first.flightStart ? first.flightStart.toISOString().slice(0, 10) : '',
    endDate: first.flightEnd ? first.flightEnd.toISOString().slice(0, 10) : '',
    amount: lines.reduce((sum, l) => sum + toNumber(l.amount), 0),
    label: first.label,
    months: lines.map((l) => ({
      id: l.id,
      period: l.period,
      amount: toNumber(l.amount),
      status: l.status,
    })),
    settledMonths: lines.filter((l) => l.status === 'settled').length,
  };
}

/**
 * Move a flight's dates and/or change its total, re-splitting the months.
 *
 * SETTLED MONTHS ARE LEFT ALONE. A settled line has a recorded actual and has
 * already been reported on; rewriting it because a later month moved would
 * change history to fix the future. Their money is subtracted from the total
 * first, and only the remainder is re-spread over the months that are still
 * open — so the buy still adds up while what's closed stays closed.
 *
 * A month that drops out of the new range is CANCELED rather than deleted, so
 * the audit trail survives.
 */
export async function updateFlight(
  flightId: string,
  patch: { startDate?: string; endDate?: string; amount?: number; label?: string | null },
  userId: string | null = null,
): Promise<FlightDTO | null> {
  const existing = await prisma.budgetLine.findMany({
    where: { flightId, ...NOT_ARCHIVED },
    orderBy: { period: 'asc' },
  });
  if (existing.length === 0) return null;

  const first = existing[0]!;
  const start = patch.startDate
    ? parseDate(patch.startDate, 'startDate')
    : (first.flightStart ?? parseDate(`${first.year}-01-01`, 'startDate'));
  const end = patch.endDate
    ? parseDate(patch.endDate, 'endDate')
    : (first.flightEnd ?? parseDate(`${first.year}-12-31`, 'endDate'));
  if (end < start) throw new Error('The flight ends before it starts');

  const currentTotal = existing.reduce((sum, l) => sum + toNumber(l.amount), 0);
  const total = patch.amount ?? currentTotal;
  assertAmount(total);

  const settled = existing.filter((l) => l.status === 'settled');
  const settledTotal = settled.reduce((sum, l) => sum + toNumber(l.amount), 0);
  if (settledTotal > total) {
    throw new Error(
      `Settled months already account for $${settledTotal.toFixed(2)}, which is more than the new total.`,
    );
  }
  const settledPeriods = new Set(settled.map((l) => l.period));

  // Re-split only what isn't already closed, over only the months that are
  // open — weighted by each month's days, same rule as the initial split.
  const openParts = splitFlight(start, end, total).filter((p) => !settledPeriods.has(p.period));
  const openShares = splitToCents(
    openParts.map((p) => ({ id: p.period, spendTarget: p.days })),
    total - settledTotal,
  );
  const shareByPeriod = new Map(openShares.map((sh) => [sh.id, sh.actual]));

  const byPeriod = new Map(existing.map((l) => [l.period, l]));
  const keep = new Set<string>(settledPeriods as Set<string>);

  await prisma.$transaction(async (tx) => {
    for (const part of openParts) {
      keep.add(part.period);
      const amount = shareByPeriod.get(part.period) ?? 0;
      const row = byPeriod.get(part.period);
      if (row) {
        await tx.budgetLine.update({
          where: { id: row.id },
          data: {
            amount: decimal(amount),
            flightStart: start,
            flightEnd: end,
            ...(patch.label !== undefined ? { label: patch.label } : {}),
          },
        });
      }
    }
    // Months no longer in range: cancel, don't delete.
    for (const row of existing) {
      if (row.period && !keep.has(row.period)) {
        await tx.budgetLine.update({
          where: { id: row.id },
          data: { status: 'canceled' },
        });
      }
    }
    // Settled rows keep their money but follow the new dates, so the drawer
    // doesn't show a settled month claiming a range it's no longer part of.
    for (const row of settled) {
      await tx.budgetLine.update({
        where: { id: row.id },
        data: { flightStart: start, flightEnd: end },
      });
    }
  });

  // Months the new range adds. Created outside the transaction because
  // `createLines` resolves markup and writes its own events.
  const missing = openParts.filter((p) => !byPeriod.has(p.period));
  if (missing.length > 0) {
    await createLines(
      missing.map((part) => ({
        accountKey: first.accountKey,
        spendAccountKey: first.spendAccountKey,
        period: part.period,
        channel: first.channel,
        amount: shareByPeriod.get(part.period) ?? 0,
        status: first.status === 'settled' ? 'committed' : first.status,
        bucket: first.bucket,
        source: first.source,
        lineType: first.lineType as BudgetLineType,
        agreementId: first.agreementId,
        initiativeId: first.initiativeId,
        taskId: first.taskId,
        label: patch.label !== undefined ? patch.label : first.label,
        flightId,
        flightStart: start,
        flightEnd: end,
      })),
      userId,
      { groupId: flightId },
    );
  }

  return getFlight(flightId);
}

/** Cancel every open month of a flight. Settled months are left as history. */
export async function cancelFlight(flightId: string): Promise<number> {
  const { count } = await prisma.budgetLine.updateMany({
    where: { flightId, status: { notIn: ['settled', 'canceled'] }, ...NOT_ARCHIVED },
    data: { status: 'canceled' },
  });
  return count;
}

// ── Pacer binding (Phase 3) ─────────────────────────────────────────────────
//
// The ONE write path from the ledger into the Ad Pacer. Direction is strictly
// budget → pacer: this writes MetaAdsPacerPeriodBudget's goal fields, and
// nothing in the pacer ever writes back. Actuals return for display and
// settlement only.
//
// A period is only written when its per-platform `managedByBudget` flag is on
// — opt-in per account, so switching Loomi on for one client doesn't disturb
// every specialist's hand-typed numbers at once.

/** Which pacer columns a platform owns. Meta keeps the original pair. */
function pacerColumns(platform: PacerPlatform) {
  return platform === 'google'
    ? { base: 'googleBaseBudgetGoal', added: 'googleAddedBudgetGoal', managed: 'googleManagedByBudget' } as const
    : { base: 'baseBudgetGoal', added: 'addedBudgetGoal', managed: 'managedByBudget' } as const;
}

export interface PacerSyncResult {
  synced: boolean;
  /** Why it didn't sync, when it didn't — surfaced so callers can explain. */
  reason?: 'no_plan' | 'not_managed' | 'frozen' | 'unchanged' | 'error';
  base?: number;
  added?: number;
}

/**
 * Push one account/period/platform's line totals into the pacer's budget goals.
 *
 * Skipped (never throws) when: the account has no pacer plan, the period isn't
 * budget-managed, or the month is frozen. A frozen month is a settled record —
 * a late budget edit must not silently rewrite history behind the freeze.
 */
export async function syncPeriodBudgetFromLines(
  spendAccountKey: string,
  period: string,
  platform: PacerPlatform,
  authorUserId: string | null = null,
): Promise<PacerSyncResult> {
  if (!isValidPeriodPure(period)) throw new Error(`Invalid period "${period}"`);

  const plan = await prisma.metaAdsPacerPlan.findUnique({
    where: { accountKey: spendAccountKey },
    select: { id: true },
  });
  if (!plan) return { synced: false, reason: 'no_plan' };

  const cols = pacerColumns(platform);
  const existing = await prisma.metaAdsPacerPeriodBudget.findUnique({
    where: { planId_period: { planId: plan.id, period } },
    select: { managedByBudget: true, googleManagedByBudget: true, [cols.base]: true, [cols.added]: true },
  });
  if (!existing?.[cols.managed]) return { synced: false, reason: 'not_managed' };

  if (!(await isPeriodWritable(spendAccountKey, plan.id, period))) {
    return { synced: false, reason: 'frozen' };
  }

  const { base, added } = await getPacerBudgetGoals(spendAccountKey, period, platform);
  // Stored as strings to match every other money field on the pacer models.
  // A managed month with no lines is a real $0, not "unset" — writing null
  // would read back as never-configured.
  const nextBase = base.toFixed(2);
  const nextAdded = added.toFixed(2);
  const prevBase = (existing[cols.base] as string | null) ?? null;
  const prevAdded = (existing[cols.added] as string | null) ?? null;

  // Same numbers → no write, no audit noise. Compared numerically so "1000"
  // and "1000.00" don't log as a change on every line edit.
  const same = (a: string | null, b: string) => a != null && Number(a) === Number(b);
  if (same(prevBase, nextBase) && same(prevAdded, nextAdded)) {
    return { synced: false, reason: 'unchanged', base, added };
  }

  await prisma.metaAdsPacerPeriodBudget.update({
    where: { planId_period: { planId: plan.id, period } },
    data: { [cols.base]: nextBase, [cols.added]: nextAdded },
  });

  await writeAudit([
    {
      accountKey: spendAccountKey,
      planId: plan.id,
      period,
      platform,
      action: 'edit',
      field: cols.base,
      fromValue: prevBase,
      toValue: nextBase,
      summary: `Budget goals synced from ledger — base ${money(base)}, added ${money(added)}`,
      authorUserId,
    },
  ]);

  return { synced: true, base, added };
}

/**
 * Re-sync every pacer period a set of lines touches. Called after any ledger
 * mutation.
 *
 * Takes the placements as (period, channel) pairs rather than line ids because
 * an EDIT has two of them — the placement before the change and the one after
 * — and both need re-syncing or the month a line moved out of keeps its old
 * total. De-duped to one sync per (period, platform).
 *
 * Never throws: the ledger write already succeeded and is the source of truth;
 * a pacer that's briefly stale is recoverable (the next edit, or an explicit
 * re-manage, re-syncs it), whereas failing the budget write here would lose it.
 */
export async function syncPacerForPlacements(
  placements: {
    spendAccountKey: string;
    period: string | null;
    channel: string | null;
  }[],
  authorUserId: string | null = null,
): Promise<void> {
  const seen = new Set<string>();
  for (const p of placements) {
    if (!p.period || !p.channel) continue; // pool money reaches no pacer
    const platform = channelPacerPlatform(p.channel);
    if (!platform) continue; // radio/print/etc. settle by hand
    const key = `${p.spendAccountKey}|${p.period}|${platform}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await syncPeriodBudgetFromLines(p.spendAccountKey, p.period, platform, authorUserId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[budget] pacer sync failed', key, err);
    }
  }
}

/**
 * Turn budget management on or off for one account/period/platform.
 *
 * Managing syncs immediately, so the goal fields never sit locked showing a
 * stale hand-typed number. Unmanaging deliberately LEAVES the last synced
 * value in place: reverting to whatever was typed before the handover would
 * resurrect a number nobody has looked at since, which is the more surprising
 * of the two behaviors. The specialist edits from the current figure.
 */
export async function setPeriodManaged(
  spendAccountKey: string,
  period: string,
  platform: PacerPlatform,
  managed: boolean,
  authorUserId: string | null = null,
): Promise<PacerSyncResult> {
  if (!isValidPeriodPure(period)) throw new Error(`Invalid period "${period}"`);

  const plan = await prisma.metaAdsPacerPlan.findUnique({
    where: { accountKey: spendAccountKey },
    select: { id: true },
  });
  if (!plan) throw new Error(`${spendAccountKey} has no Ad Pacer plan to manage.`);

  if (!(await isPeriodWritable(spendAccountKey, plan.id, period))) {
    throw new Error('This month is frozen. Reopen it before changing budget management.');
  }

  const cols = pacerColumns(platform);
  await prisma.metaAdsPacerPeriodBudget.upsert({
    where: { planId_period: { planId: plan.id, period } },
    create: { planId: plan.id, period, [cols.managed]: managed },
    update: { [cols.managed]: managed },
  });

  await writeAudit([
    {
      accountKey: spendAccountKey,
      planId: plan.id,
      period,
      platform,
      action: 'edit',
      field: cols.managed,
      fromValue: String(!managed),
      toValue: String(managed),
      summary: managed
        ? 'Budget goals now managed by the budget ledger'
        : 'Budget management turned off — goals are hand-entered again',
      authorUserId,
    },
  ]);

  if (!managed) return { synced: false, reason: 'not_managed' };
  return syncPeriodBudgetFromLines(spendAccountKey, period, platform, authorUserId);
}

/** Whether each platform's goals are ledger-managed for this account/period. */
export async function getPeriodManagement(
  spendAccountKey: string,
  period: string,
): Promise<{ meta: boolean; google: boolean }> {
  const plan = await prisma.metaAdsPacerPlan.findUnique({
    where: { accountKey: spendAccountKey },
    select: { id: true },
  });
  if (!plan) return { meta: false, google: false };
  const row = await prisma.metaAdsPacerPeriodBudget.findUnique({
    where: { planId_period: { planId: plan.id, period } },
    select: { managedByBudget: true, googleManagedByBudget: true },
  });
  return { meta: !!row?.managedByBudget, google: !!row?.googleManagedByBudget };
}

// ── Settlement (Phase 4) ────────────────────────────────────────────────────
//
// Closing a month: record what each line ACTUALLY cost and mark it settled.
// This is what replaces oz-reports' `budget_utilization` — a second table
// mirroring the budget table's shape, which drifted from it. Here it's a state
// transition plus two fields on the line the money already lives on.
//
// `actualAmount` is in SPEND dollars, the same units as `spendTarget` — not
// client gross. It comes from the platform (or a human) as spend, and
// converting it back through a markup to compare against `amount` would invent
// precision the number doesn't have.

export interface SettlementResult {
  settled: number;
  /** Total actual spend attributed, in spend dollars. */
  attributed: number;
  /** Spend the platform reported that no committed line was there to absorb. */
  orphaned: number;
  skipped?: 'not_closed' | 'no_plan' | 'no_lines';
}

/**
 * Settle one account/period/platform from the pacer's synced spend.
 *
 * Refuses to run until the month is CLOSED (past the pacer's grace window)
 * unless forced — settling a live month would freeze a number that's still
 * moving. Already-settled lines are left alone, so re-running is safe.
 */
export async function settlePlatformPeriod(
  spendAccountKey: string,
  period: string,
  platform: PacerPlatform,
  userId: string | null = null,
  opts: { force?: boolean } = {},
): Promise<SettlementResult> {
  if (!isValidPeriodPure(period)) throw new Error(`Invalid period "${period}"`);

  const empty: SettlementResult = { settled: 0, attributed: 0, orphaned: 0 };

  if (!opts.force) {
    const tz = await accountTimeZone(spendAccountKey);
    if (monthState(period, tz) !== 'closed') {
      return { ...empty, skipped: 'not_closed' };
    }
  }

  const plan = await prisma.metaAdsPacerPlan.findUnique({
    where: { accountKey: spendAccountKey },
    select: { id: true },
  });
  if (!plan) return { ...empty, skipped: 'no_plan' };

  // Actual spend for the month, split base vs added the same way the pacer
  // splits it (adContribution handles the 'split' ads proportionally).
  const ads = await prisma.metaAdsPacerAd.findMany({
    where: { planId: plan.id, period, ...adPlatformWhere(platform) },
    select: {
      allocation: true,
      pacerActual: true,
      budgetSource: true,
      splitBaseAmount: true,
    },
  });
  const actualByBucket = { base: 0, added: 0 };
  for (const ad of ads) {
    const c = adContribution({
      allocation: ad.allocation,
      pacerActual: ad.pacerActual,
      budgetSource: ad.budgetSource as 'base' | 'added' | 'split',
      splitBaseAmount: ad.splitBaseAmount,
    });
    actualByBucket.base += c.baseSpent;
    actualByBucket.added += c.addedSpent;
  }

  const lines = await prisma.budgetLine.findMany({
    where: {
      spendAccountKey,
      period,
      channel: { in: channelsForPlatform(platform) },
      status: { in: ['committed', 'live'] },
      ...NOT_ARCHIVED,
    },
    select: { id: true, amount: true, markupSnapshot: true, bucket: true, label: true },
  });
  if (lines.length === 0) {
    const orphaned = actualByBucket.base + actualByBucket.added;
    return { ...empty, orphaned, skipped: 'no_lines' };
  }

  const groupId = crypto.randomUUID();
  let settled = 0;
  let attributed = 0;
  let orphaned = 0;

  for (const bucket of ['base', 'added'] as const) {
    const bucketLines = lines.filter((l) =>
      bucket === 'base' ? l.bucket === 'base' : l.bucket !== 'base',
    );
    const bucketActual = actualByBucket[bucket];

    // Spend in a bucket with no line behind it can't be attributed. Reported
    // rather than silently folded into the other bucket — it usually means an
    // ad was pointed at a budget source nothing funded.
    if (bucketLines.length === 0) {
      orphaned += bucketActual;
      continue;
    }

    const shares = splitToCents(
      bucketLines.map((l) => ({
        id: l.id,
        spendTarget: toNumber(l.amount) * l.markupSnapshot,
      })),
      bucketActual,
    );

    for (const share of shares) {
      const line = bucketLines.find((l) => l.id === share.id)!;
      const target = toNumber(line.amount) * line.markupSnapshot;
      await prisma.budgetLine.update({
        where: { id: share.id },
        data: {
          status: 'settled',
          actualAmount: decimal(share.actual),
          settledAt: new Date(),
        },
      });
      const delta = share.actual - target;
      await writeBudgetEvent({
        lineId: share.id,
        action: 'settled',
        field: 'actualAmount',
        toValue: String(share.actual),
        summary:
          `Settled at ${money(share.actual)} actual vs ${money(target)} target` +
          (Math.abs(delta) < 0.005
            ? ' — on target'
            : delta > 0
              ? ` — ${money(delta)} over`
              : ` — ${money(-delta)} under`),
        groupId,
        authorUserId: userId,
      });
      settled++;
      attributed += share.actual;
    }
  }

  return { settled, attributed, orphaned };
}

/**
 * Record what a line actually cost by hand. The only route for radio, print,
 * TV, video and PR — they have no platform to sync from, so a human closes them
 * out. Also the correction path for a platform line settled wrong.
 */
export async function settleLineManually(
  id: string,
  actualAmount: number,
  userId: string | null = null,
): Promise<BudgetLineDTO | null> {
  assertAmount(actualAmount, 'actualAmount');
  const existing = await prisma.budgetLine.findUnique({ where: { id } });
  if (!existing || existing.archivedAt) return null;

  const target = toNumber(existing.amount) * existing.markupSnapshot;
  const previous = existing.actualAmount == null ? null : toNumber(existing.actualAmount);
  const delta = actualAmount - target;

  const row = await prisma.budgetLine.update({
    where: { id },
    data: {
      status: 'settled',
      actualAmount: decimal(actualAmount),
      settledAt: existing.settledAt ?? new Date(),
    },
    include: LINE_INCLUDE,
  });

  await writeBudgetEvent({
    lineId: id,
    action: 'settled',
    field: 'actualAmount',
    fromValue: previous == null ? null : String(previous),
    toValue: String(actualAmount),
    summary:
      (previous == null ? 'Settled' : 'Actual corrected') +
      ` at ${money(actualAmount)} vs ${money(target)} target` +
      (Math.abs(delta) < 0.005
        ? ' — on target'
        : delta > 0
          ? ` — ${money(delta)} over`
          : ` — ${money(-delta)} under`),
    authorUserId: userId,
  });

  return serializeLine(row);
}

/**
 * Reopen a settled line for correction: clears the actual and drops it back to
 * committed. Kept explicit rather than letting a plain status edit do it, so
 * the recorded actual can't be orphaned on a line that no longer claims to be
 * settled.
 */
export async function unsettleLine(
  id: string,
  userId: string | null = null,
): Promise<BudgetLineDTO | null> {
  const existing = await prisma.budgetLine.findUnique({ where: { id } });
  if (!existing || existing.status !== 'settled') return null;

  const row = await prisma.budgetLine.update({
    where: { id },
    data: { status: 'committed', actualAmount: null, settledAt: null },
    include: LINE_INCLUDE,
  });
  await writeBudgetEvent({
    lineId: id,
    action: 'edited',
    field: 'status',
    fromValue: 'settled',
    toValue: 'committed',
    summary: 'Reopened for correction — recorded actual cleared',
    authorUserId: userId,
  });
  return serializeLine(row);
}

/**
 * Daily pass: settle every closed month that still has committed lines on a
 * paced channel. Piggybacks on the pacer alert scan, which already refreshes
 * spend from the platforms first — settling before that sync would freeze
 * yesterday's numbers.
 *
 * Bounded to the last `lookbackMonths` so a long-dormant account doesn't
 * trigger a year of settlement on one cron run.
 */
export async function settleClosedMonths(
  lookbackMonths = 3,
): Promise<{ accounts: number; settled: number; orphaned: number; errors: string[] }> {
  const errors: string[] = [];
  let accounts = 0;
  let settled = 0;
  let orphaned = 0;

  // Candidate (account, period) pairs: anything still committed on a paced
  // channel, old enough to be closed.
  const pacedChannels = [...channelsForPlatform('meta'), ...channelsForPlatform('google')];
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - lookbackMonths);
  const cutoffPeriod = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;

  const pending = await prisma.budgetLine.findMany({
    where: {
      channel: { in: pacedChannels },
      status: { in: ['committed', 'live'] },
      period: { not: null, gte: cutoffPeriod },
      ...NOT_ARCHIVED,
    },
    select: { spendAccountKey: true, period: true, channel: true },
    distinct: ['spendAccountKey', 'period', 'channel'],
  });

  // Collapse to (account, period, platform) — google and youtube share one.
  const targets = new Map<string, { key: string; period: string; platform: PacerPlatform }>();
  for (const row of pending) {
    const platform = channelPacerPlatform(row.channel);
    if (!platform || !row.period) continue;
    targets.set(`${row.spendAccountKey}|${row.period}|${platform}`, {
      key: row.spendAccountKey,
      period: row.period,
      platform,
    });
  }

  for (const t of targets.values()) {
    try {
      const res = await settlePlatformPeriod(t.key, t.period, t.platform, null);
      if (res.settled > 0) accounts++;
      settled += res.settled;
      orphaned += res.orphaned;
    } catch (err) {
      errors.push(
        `${t.key} ${t.period} ${t.platform}: ${err instanceof Error ? err.message : 'failed'}`,
      );
    }
  }

  return { accounts, settled, orphaned, errors };
}

// ── Import (Oz Reports migration) ───────────────────────────────────────────

export interface ImportResult {
  created: number;
  updated: number;
  archived: number;
  /** Rows the push sent that couldn't be placed, with why. */
  rejected: { externalId: string; reason: string }[];
}

/**
 * Upsert lines from an external system, keyed on `externalId`.
 *
 * Idempotent by construction: a second run updates in place rather than
 * duplicating the ledger, which also means a corrected row in the source can
 * simply be re-pushed. See docs/budget-module.md §6.
 *
 * `archivedExternalIds` retires lines whose source row has since been deleted.
 * Without it a dual-run leaks: a budget deleted in Oz Reports would live on in
 * Loomi forever, because a deleted row simply stops appearing in the push.
 *
 * A rejected row never aborts the batch — one bad line shouldn't strand the
 * other 8,000. They come back named so the caller can report them.
 */
export async function upsertImportedLines(
  inputs: (CreateLineInput & { externalId: string })[],
  archivedExternalIds: string[] = [],
  userId: string | null = null,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, archived: 0, rejected: [] };
  const placements: { spendAccountKey: string; period: string | null; channel: string | null }[] = [];

  // Resolve markup once per (account, year) — 8,000 lines across ~40 accounts
  // would otherwise be thousands of identical lookups.
  const markupCache = new Map<string, number>();

  for (const input of inputs) {
    try {
      const year = resolveYear(input.period, input.year);
      if (input.channel != null && !isBudgetChannel(input.channel)) {
        throw new Error(`Unknown budget channel "${input.channel}"`);
      }
      assertAmount(input.amount);

      let markup = input.markup ?? null;
      if (markup == null) {
        const cacheKey = `${input.accountKey}:${year}`;
        if (!markupCache.has(cacheKey)) {
          markupCache.set(cacheKey, await resolveMarkup(input.accountKey, year));
        }
        markup = markupCache.get(cacheKey)!;
      }

      const source = input.source ?? 'adhoc';
      const data = {
        accountKey: input.accountKey,
        spendAccountKey: input.spendAccountKey || input.accountKey,
        year,
        period: input.period ?? null,
        channel: input.channel ?? null,
        category: channelCategory(input.channel ?? null),
        amount: decimal(input.amount),
        markupSnapshot: markup,
        source,
        status: input.status ?? 'committed',
        bucket: input.bucket ?? defaultBucket(source),
        lineType: input.lineType ?? channelLineType(input.channel ?? null),
        cost: input.cost == null ? null : decimal(input.cost),
        batchId: input.batchId ?? null,
        label: input.label ?? null,
        notes: input.notes ?? null,
      };

      const existing = await prisma.budgetLine.findUnique({
        where: { externalId: input.externalId },
        select: { id: true, period: true, channel: true, spendAccountKey: true },
      });

      if (existing) {
        // Re-sync the placement it's LEAVING as well as the one it lands on —
        // an edit in Oz Reports can move a line between months.
        placements.push({
          spendAccountKey: existing.spendAccountKey,
          period: existing.period,
          channel: existing.channel,
        });
        await prisma.budgetLine.update({
          where: { externalId: input.externalId },
          // A re-import is the source correcting itself, so un-archive too.
          data: { ...data, archivedAt: null },
        });
        result.updated++;
      } else {
        await prisma.budgetLine.create({
          data: { ...data, externalId: input.externalId, createdByUserId: userId },
        });
        result.created++;
      }
      placements.push({
        spendAccountKey: data.spendAccountKey,
        period: data.period,
        channel: data.channel,
      });
    } catch (err) {
      result.rejected.push({
        externalId: input.externalId,
        reason: err instanceof Error ? err.message : 'failed',
      });
    }
  }

  if (archivedExternalIds.length > 0) {
    const retiring = await prisma.budgetLine.findMany({
      where: { externalId: { in: archivedExternalIds }, archivedAt: null },
      select: { spendAccountKey: true, period: true, channel: true },
    });
    placements.push(...retiring);
    const { count } = await prisma.budgetLine.updateMany({
      where: { externalId: { in: archivedExternalIds }, archivedAt: null },
      data: { archivedAt: new Date(), status: 'canceled' },
    });
    result.archived = count;
  }

  // One pass at the end rather than per line — an 8,000-line import would
  // otherwise re-sync the same months thousands of times.
  await syncPacerForPlacements(placements, userId);

  return result;
}
