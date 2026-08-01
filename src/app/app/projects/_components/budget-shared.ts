'use client';

/**
 * Shapes and formatters shared by the budget hub and its line drawer.
 *
 * Split out so the two components don't import from each other — the hub
 * renders the drawer and the drawer needs the hub's types, which is a cycle
 * bundlers tolerate right up until they don't.
 */

/** A BudgetLine as `/api/budget/lines` serializes it (see services/budget.ts). */
export type BudgetLine = {
  id: string;
  accountKey: string;
  accountDealer: string | null;
  spendAccountKey: string;
  spendAccountDealer: string | null;
  isCrossAccount: boolean;
  year: number;
  period: string | null;
  channel: string | null;
  category: string | null;
  amount: number;
  markupSnapshot: number;
  lineType: string;
  cost: number | null;
  effectiveCost: number | null;
  revenue: number | null;
  margin: number | null;
  spendTarget: number;
  source: string;
  status: string;
  bucket: string;
  initiativeId: string | null;
  initiativeName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  batchId: string | null;
  /** Set when this line is one month of a dated media buy. */
  flightId: string | null;
  flightStart: string | null;
  flightEnd: string | null;
  actualAmount: number | null;
  settledAt: string | null;
  label: string | null;
  notes: string | null;
  isPool: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BudgetSummary = {
  accountKey: string;
  year: number;
  declaredTotal: number | null;
  monthlyRetainer: number | null;
  totalCommitted: number;
  allocated: number;
  pool: number;
  /** The standing budget vs everything requested on top — the pacer's two goals. */
  baseTotal: number;
  addedTotal: number;
  unplanned: number | null;
  overAllocated: boolean;
  byChannel: { channel: string; amount: number; spendTarget: number }[];
  byPeriod: { period: string; amount: number; spendTarget: number }[];
  byLineType: {
    lineType: string;
    amount: number;
    cost: number;
    revenue: number;
    costKnown: boolean;
    lines: number;
  }[];
  knownRevenue: number;
  uncostedAmount: number;
};

export type AgreementFee = {
  id?: string;
  channel: string;
  monthlyAmount: number;
  label: string | null;
};

/**
 * What the client signed, with real term dates. A term can straddle the new
 * year, so `commitmentForYear` is its pro-rated share of the year being viewed
 * — not the whole contract value.
 */
export type BudgetAgreement = {
  id: string;
  accountKey: string;
  name: string;
  startDate: string;
  endDate: string;
  committedAmount: number | null;
  status: string;
  defaultMarkup: number | null;
  notes: string | null;
  termMonths: number;
  monthsInYear: number | null;
  commitmentForYear: number | null;
  monthlyFeeTotal: number;
  fees: AgreementFee[];
  /** Committed/live/settled lines linked to this agreement, in the year viewed. */
  booked: number;
};

/** A dated media buy, with the monthly lines it laid out. */
export type BudgetFlight = {
  flightId: string;
  accountKey: string;
  channel: string | null;
  startDate: string;
  endDate: string;
  amount: number;
  label: string | null;
  months: { id: string; period: string | null; amount: number; status: string }[];
  /** Months already closed out. These are never re-split. */
  settledMonths: number;
};

export type BudgetLineEvent = {
  id: string;
  action: string;
  field: string | null;
  fromValue: string | null;
  toValue: string | null;
  summary: string;
  counterpartyLineId: string | null;
  groupId: string | null;
  author: { id: string; name: string } | null;
  createdAt: string;
};

export const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const usd0 = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const usd2 = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

/** Compact money for grid cells — $12.5k reads better than $12,500 at that density. */
export function compactMoney(n: number): string {
  if (n === 0) return '—';
  if (Math.abs(n) >= 1000) {
    const k = n / 1000;
    return `$${(Math.round(k * 10) / 10).toLocaleString('en-US')}k`;
  }
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** Month index (0-11) for a "YYYY-MM" period, or -1 if malformed. */
export function monthIndexOf(period: string): number {
  const m = Number(period.slice(5, 7)) - 1;
  return m >= 0 && m <= 11 ? m : -1;
}

/**
 * One colour per kind of money, shared by the composition bar and its legend.
 *
 * Categorical, not a scale — these aren't more or less of anything, they're
 * different things, so no ramp. `unclassified` is amber deliberately: it's the
 * only one that means "something is missing", and it already reads as a warning
 * everywhere else on the page.
 *
 * Tailwind palette rather than a CSS variable because these need to be five
 * distinguishable hues, and the theme only defines one accent.
 */
export const LINE_TYPE_COLOR: Record<string, string> = {
  media: 'bg-sky-500',
  service: 'bg-violet-500',
  fee: 'bg-emerald-500',
  production: 'bg-fuchsia-500',
  unclassified: 'bg-amber-500',
};

export const SOURCE_LABEL: Record<string, string> = {
  retainer: 'Managed Marketing Service',
  task: 'From a Ticket',
  adhoc: 'Added Here',
  pool: 'Pool',
};

/**
 * Display labels for the stored status keys. The keys stay lowercase — they're
 * identifiers the API and DB agree on — but nothing lowercase should reach the
 * screen.
 */
export const STATUS_LABEL: Record<string, string> = {
  // 'Draft' rather than 'Planned' — the hub's Planned card counts committed
  // money, and a status called Planned that the Planned card EXCLUDES is the
  // kind of collision nobody ever stops tripping over. The stored value is
  // still 'planned'; only the word people read changed.
  planned: 'Draft',
  committed: 'Committed',
  live: 'Live',
  settled: 'Settled',
  canceled: 'Canceled',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? titleCase(status);
}

/** Which Ad Pacer pool a line feeds. Stored as base|added. */
export const BUCKET_LABEL: Record<string, string> = {
  base: 'Base',
  added: 'Added',
};

export function bucketLabel(bucket: string): string {
  return BUCKET_LABEL[bucket] ?? titleCase(bucket);
}

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? titleCase(source);
}

/** Last-resort fallback so an unmapped key still renders capitalized. */
export function titleCase(v: string): string {
  return v
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

export const STATUS_STYLE: Record<string, string> = {
  planned: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  committed: 'bg-blue-500/10 text-blue-500',
  live: 'bg-green-500/10 text-green-600',
  settled: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  canceled: 'bg-red-500/10 text-red-500',
};

/** Statuses a line can be moved between by hand. `canceled` is a release action. */
export const EDITABLE_STATUSES = ['planned', 'committed', 'live', 'settled'];
