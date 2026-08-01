import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { accountMarginSetting } from '@/lib/ad-pacer/markup';
import { getGlobalDefaultMarkup } from '@/lib/services/markup';
import {
  channelCategory,
  channelPacerPlatform,
  channelsForPlatform,
  isBudgetChannel,
  type PacerPlatform,
} from '@/lib/budget/channels';
import { isValidPeriod as isValidPeriodPure, resolveYear } from '@/lib/budget/period';
import {
  accountTimeZone,
  adPlatformWhere,
  isPeriodWritable,
  monthState,
} from '@/lib/meta-ads-pacer';
import { writeAudit } from '@/lib/meta-ads-audit';
import { adContribution } from '@/lib/ad-pacer/helpers';
import { distributeActual } from '@/lib/budget/settlement';

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
  const [plan, account, globalDefault] = await Promise.all([
    prisma.budgetPlan.findUnique({
      where: { accountKey_year: { accountKey, year } },
      select: { defaultMarkup: true },
    }),
    prisma.account.findUnique({ where: { key: accountKey }, select: { markup: true } }),
    getGlobalDefaultMarkup(),
  ]);
  if (plan?.defaultMarkup != null) {
    return accountMarginSetting(plan.defaultMarkup, globalDefault);
  }
  return accountMarginSetting(account?.markup ?? null, globalDefault);
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
    // What should actually hit the platform. Derived, never stored — the
    // stored pair (amount, markupSnapshot) is the record.
    spendTarget: amount * l.markupSnapshot,
    source: l.source,
    status: l.status,
    bucket: l.bucket,
    initiativeId: l.initiativeId,
    initiativeName: l.initiative?.name ?? null,
    taskId: l.taskId,
    taskTitle: l.task?.title ?? null,
    batchId: l.batchId,
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

// ── Plans ───────────────────────────────────────────────────────────────────

export async function getPlan(accountKey: string, year: number) {
  return prisma.budgetPlan.findUnique({ where: { accountKey_year: { accountKey, year } } });
}

export async function upsertPlan(input: {
  accountKey: string;
  year: number;
  declaredTotal?: number | null;
  monthlyRetainer?: number | null;
  defaultMarkup?: number | null;
  notes?: string | null;
  userId?: string | null;
}) {
  const { accountKey, year } = input;
  if (input.declaredTotal != null) assertAmount(input.declaredTotal, 'declaredTotal');
  if (input.monthlyRetainer != null) assertAmount(input.monthlyRetainer, 'monthlyRetainer');

  const data = {
    declaredTotal: input.declaredTotal == null ? null : decimal(input.declaredTotal),
    monthlyRetainer: input.monthlyRetainer == null ? null : decimal(input.monthlyRetainer),
    defaultMarkup: input.defaultMarkup ?? null,
    notes: input.notes ?? null,
  };
  return prisma.budgetPlan.upsert({
    where: { accountKey_year: { accountKey, year } },
    create: { accountKey, year, ...data, createdByUserId: input.userId ?? null },
    update: data,
  });
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
  initiativeId?: string | null;
  taskId?: string | null;
  batchId?: string | null;
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
        initiativeId: input.initiativeId ?? null,
        taskId: input.taskId ?? null,
        batchId: input.batchId ?? batchId,
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
  monthlyRetainer: number | null;
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
  const [plan, lines] = await Promise.all([
    getPlan(accountKey, year),
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
      },
    }),
  ]);

  const placed = lines.filter((l) => l.period != null && l.channel != null);
  const pooled = lines.filter((l) => l.period == null || l.channel == null);

  const allocated = toNumber(sumDecimal(placed.map((l) => l.amount)));
  const pool = toNumber(sumDecimal(pooled.map((l) => l.amount)));
  const totalCommitted = allocated + pool;
  const declaredTotal = plan?.declaredTotal == null ? null : toNumber(plan.declaredTotal);

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

  return {
    accountKey,
    year,
    declaredTotal,
    monthlyRetainer: plan?.monthlyRetainer == null ? null : toNumber(plan.monthlyRetainer),
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
 * Stamp a year of retainer lines from BudgetPlan.monthlyRetainer — the
 * equivalent of oz-reports' bulk entry, and the reason batchId exists. Skips
 * months that already carry a retainer line so re-running is safe.
 */
export async function generateRetainerLines(
  accountKey: string,
  year: number,
  opts: { channel?: string | null; months?: number[] } = {},
  userId: string | null = null,
): Promise<BudgetLineDTO[]> {
  const plan = await getPlan(accountKey, year);
  const monthly = plan?.monthlyRetainer == null ? 0 : toNumber(plan.monthlyRetainer);
  if (monthly <= 0) {
    throw new Error('Set a monthly retainer on the budget plan before generating lines.');
  }
  const months = opts.months?.length ? opts.months : Array.from({ length: 12 }, (_, i) => i + 1);

  const existing = await prisma.budgetLine.findMany({
    where: { accountKey, year, source: 'retainer', ...NOT_ARCHIVED },
    select: { period: true },
  });
  const taken = new Set(existing.map((e) => e.period).filter(Boolean));

  const inputs: CreateLineInput[] = months
    .map((m) => `${year}-${String(m).padStart(2, '0')}`)
    .filter((period) => !taken.has(period))
    .map((period) => ({
      accountKey,
      year,
      period,
      channel: opts.channel ?? null,
      amount: monthly,
      source: 'retainer',
      status: 'committed',
      label: 'Managed Marketing Service',
    }));

  return createLines(inputs, userId);
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

    const shares = distributeActual(
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
