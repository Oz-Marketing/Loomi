/**
 * Out-of-home boards — port of Oz Dealer Tools' BillboardReport.
 *
 * ── SHARING IS THE ACCOUNT HIERARCHY, NOT A NEW SYSTEM ──────────────────────
 * ODT had an `is_group_level` flag: a board owned by a group showed for every
 * org beneath it. That was the one thing in the whole migration with no Loomi
 * equivalent — until you notice Loomi already has the relationship. A board on
 * a group account with `sharedWithChildren` is visible to that account's
 * descendants, and `visibleAccountKeys` below is the whole implementation.
 *
 * The alternative — a join table of explicit shares — would have been a second
 * hierarchy to keep in step with the real one, and the first time someone
 * re-parented a rooftop the shares would quietly point at the wrong place.
 *
 * ── EXPIRY IS DERIVED, NOT STORED ───────────────────────────────────────────
 * ODT ran an `autoExpire()` sweep that UPDATEd rows whose date had passed,
 * which means a board's status was correct only as recently as the last time
 * someone loaded the page. Here `status` records intent (active / archived) and
 * expiry is computed from the date at read time, so a board is never stale and
 * a contract that ends tonight doesn't need a cron job to notice.
 */
import { prisma } from '@/lib/prisma';

export type BoardState = 'active' | 'expiring' | 'expired' | 'archived';

export interface BillboardRow {
  id: string;
  accountKey: string;
  sharedWithChildren: boolean;
  providerName: string;
  billboardNumber: string;
  artworkUrl: string | null;
  facingDirection: string | null;
  avgDailyTraffic: number | null;
  pricePerPeriod: number | null;
  numPeriods: number;
  periodType: string;
  expirationDate: string | null;
  latitude: number;
  longitude: number;
  status: string;
  notes: string | null;
}

export interface Billboard extends BillboardRow {
  /** Derived from `status` + `expirationDate` — see the file header. */
  state: BoardState;
  /** Days until expiry; negative once past. Null with no date. */
  daysToExpiry: number | null;
  /** pricePerPeriod × numPeriods. Null when unpriced. */
  contractValue: number | null;
  /** True when this board belongs to a different account than the viewer's. */
  inherited: boolean;
}

export interface BillboardTotals {
  boards: number;
  active: number;
  expiringSoon: number;
  expired: number;
  totalDailyTraffic: number;
  totalValue: number | null;
}

/** A board inside this many days of expiry is worth flagging, not just listing. */
export const EXPIRING_SOON_DAYS = 30;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function dayDiff(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * Resolve a board's real state.
 *
 * `archived` wins over everything — it is a decision someone made, and an
 * archived board that also happens to be past its date is still archived, not
 * expired. A board with no expiry date never expires; open-ended contracts are
 * real, and treating a missing date as "expired today" would hide live boards.
 */
export function resolveState(
  status: string,
  expirationDate: string | null,
  now: Date,
): { state: BoardState; daysToExpiry: number | null } {
  if (status === 'archived') return { state: 'archived', daysToExpiry: null };
  if (!expirationDate) return { state: 'active', daysToExpiry: null };

  const days = dayDiff(now, new Date(`${expirationDate}T00:00:00Z`));
  if (days < 0) return { state: 'expired', daysToExpiry: days };
  if (days <= EXPIRING_SOON_DAYS) return { state: 'expiring', daysToExpiry: days };
  return { state: 'active', daysToExpiry: days };
}

export function withDerived(
  row: BillboardRow,
  viewerAccountKey: string,
  now: Date,
): Billboard {
  const { state, daysToExpiry } = resolveState(row.status, row.expirationDate, now);
  const price = row.pricePerPeriod;
  return {
    ...row,
    state,
    daysToExpiry,
    contractValue: price === null ? null : round2(price * (row.numPeriods || 1)),
    inherited: row.accountKey !== viewerAccountKey,
  };
}

/**
 * Totals.
 *
 * `totalValue` is null when NOTHING is priced, and otherwise sums only the
 * boards that are — with a count the UI can use to caveat it. Treating an
 * unpriced board as $0 would understate a real spend commitment and read as
 * though someone got a board for free.
 */
export function summarize(boards: Billboard[]): BillboardTotals & { pricedBoards: number } {
  const priced = boards.filter((b) => b.contractValue !== null);
  return {
    boards: boards.length,
    active: boards.filter((b) => b.state === 'active').length,
    expiringSoon: boards.filter((b) => b.state === 'expiring').length,
    expired: boards.filter((b) => b.state === 'expired').length,
    totalDailyTraffic: boards.reduce((n, b) => n + (b.avgDailyTraffic ?? 0), 0),
    totalValue: priced.length ? round2(priced.reduce((n, b) => n + (b.contractValue ?? 0), 0)) : null,
    pricedBoards: priced.length,
  };
}

/**
 * Which accounts' boards this viewer should see: their own, plus any ancestor
 * that has chosen to share down.
 *
 * `ancestors` is walked by the caller from the account hierarchy — this stays a
 * pure function so the rule is testable without a database.
 */
export function visibleAccountKeys(accountKey: string, ancestors: string[]): string[] {
  return [accountKey, ...ancestors.filter((a) => a !== accountKey)];
}

/** Walk up the parent chain. Guards against a cycle rather than hanging. */
export async function ancestorsOf(accountKey: string): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>([accountKey]);
  let current: string | null = accountKey;

  while (current) {
    const row: { parentAccountKey: string | null } | null = await prisma.account.findUnique({
      where: { key: current },
      select: { parentAccountKey: true },
    });
    const parent: string | null = row?.parentAccountKey ?? null;
    if (!parent || seen.has(parent)) break;
    seen.add(parent);
    out.push(parent);
    current = parent;
  }
  return out;
}

export async function getBillboards(accountKey: string, now: Date = new Date()) {
  const ancestors = await ancestorsOf(accountKey);
  const keys = visibleAccountKeys(accountKey, ancestors);

  const rows = await prisma.billboard.findMany({
    where: {
      OR: [
        { accountKey },
        // An ancestor's board only counts when it was explicitly shared down.
        { accountKey: { in: ancestors }, sharedWithChildren: true },
      ],
    },
    orderBy: [{ expirationDate: 'asc' }, { billboardNumber: 'asc' }],
  });

  const boards = rows.map((r) =>
    withDerived(
      {
        id: r.id,
        accountKey: r.accountKey,
        sharedWithChildren: r.sharedWithChildren,
        providerName: r.providerName,
        billboardNumber: r.billboardNumber,
        artworkUrl: r.artworkUrl,
        facingDirection: r.facingDirection,
        avgDailyTraffic: r.avgDailyTraffic,
        pricePerPeriod: r.pricePerPeriod === null ? null : Number(r.pricePerPeriod),
        numPeriods: r.numPeriods,
        periodType: r.periodType,
        expirationDate: r.expirationDate
          ? r.expirationDate.toISOString().slice(0, 10)
          : null,
        latitude: r.latitude,
        longitude: r.longitude,
        status: r.status,
        notes: r.notes,
      },
      accountKey,
      now,
    ),
  );

  return { boards, totals: summarize(boards), visibleAccountKeys: keys };
}
