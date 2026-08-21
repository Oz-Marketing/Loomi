/**
 * Cross-month spend ledger — the auditable `Raw → Out → In → Counted` chain for
 * a flight that delivers in one month but invoices in another.
 * Implements docs/reconciliation-crossmonth.md (the cross-month spec) as
 * rebuilt: Raw and Counted are now INDEPENDENTLY sourced and reconciled against
 * each other, instead of Counted being derived from Raw.
 *
 * The problem it solves: a flight running Jun 26 – Jul 3 that bills entirely in
 * July has June-dated Meta spend. Count that June spend in June AND let July's
 * invoice carry the whole flight, and the same dollars are counted twice across
 * the year.
 *
 * Design principles the shape of this module enforces:
 *  1. Raw is the account's own spend, pulled from Meta independently of the
 *     pacer rows. Counted is the pacer rows summed on a billed basis. Neither
 *     is computed from the other — that independence is what makes
 *     `Raw − Out + In == Counted` an actual CHECK rather than an identity.
 *  2. Every adjustment is a visible line (`Out`/`In`), never a silent edit to
 *     raw. `effectiveActual` already substituted the full run for the month
 *     slice, but opaquely: the month total simply changed with nothing on screen
 *     to explain it. Here the same movement is decomposed so a reader can trace
 *     raw → adjustment → counted.
 *  3. Out and In post as an atomic pair. That is structural here rather than
 *     transactional: both sides are computed from the same ledger entry in one
 *     pass, so Σ Out can never disagree with Σ In through a partial write.
 *  4. A flight whose numbers cannot be derived honestly RAISES ITS HAND
 *     (`needsReview`) instead of posting a guess. It is then excluded from the
 *     rollup, and the residual it leaves is surfaced rather than absorbed.
 *
 * The only stored intent is the billed month (`fullRunAppliedToMonth`, "count
 * this run in month X"); the only stored FACTS are the settlement snapshot
 * (`settledRunSpend`/`settledBilledDelivery`), captured once so a settled
 * posting can't move under a later re-sync. Everything else is recomputed on
 * read.
 */

import {
  effectiveActual,
  groupFlightRuns,
  runEndIso,
  type SplitRunAdLike,
} from './pacer-calc';
import { zonedTodayIso } from '@/lib/timezone';

/** A flight's month row. `name` labels the drill-down; the rest is the run. */
export type LedgerAdLike = SplitRunAdLike & {
  name?: string | null;
  /** Settlement snapshot (rebuild §5) — the full run captured at settlement. */
  settledRunSpend?: string | null;
  /** Settlement snapshot — the billed month's delivery captured at settlement. */
  settledBilledDelivery?: string | null;
  settledAt?: Date | string | null;
};

const money = (s: string | null | undefined): number => {
  if (s == null || s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const moneyOrNull = (s: string | null | undefined): number | null => {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Round to cents so summed slices compare exactly against the spec's tables. */
const cents = (n: number): number => Math.round(n * 100) / 100;

/** Money equality at cent tolerance — the whole module's comparison rule. */
export const EPSILON = 0.005;

/** Every YYYY-MM from `from` to `to` inclusive. Empty if either is missing. */
function monthsInSpan(from: string | null, to: string | null): string[] {
  if (!from || !to) return [];
  const a = from.slice(0, 7);
  const b = to.slice(0, 7);
  if (a > b) return [a];
  const out: string[] = [];
  let [y, m] = a.split('-').map(Number);
  for (let guard = 0; guard < 120; guard++) {
    const cur = `${y}-${String(m).padStart(2, '0')}`;
    out.push(cur);
    if (cur >= b) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Why a flight was pulled out of auto-reconciliation (rebuild §8, §12.6–7). */
export type FlightReviewReason =
  /** No `pacerRunSpend` and no settlement snapshot — Out/In are not derivable. */
  | 'missing_run_spend'
  /** Spans 3+ calendar months and its own rows can't place the origin lump. */
  | 'unsplittable_span'
  /** The billed month has no row, so Counted never picks the run up at all. */
  | 'billed_month_has_no_row';

/** One origin month's share of the flight's out-of-billed-month delivery. */
export interface OriginSlice {
  /** YYYY-MM the spend is DATED to by Meta (delivery), not billed to. */
  month: string;
  /** The out-of-billed-month delivery attributed to this month. */
  datedSpend: number;
  /** The ad row this slice came from, when the month has one — drill-down anchor. */
  adId: string;
}

/** One cross-month flight. Derived; only the snapshot below is stored. */
export interface FlightLedgerEntry {
  /** Stable per-flight key: the Meta ad-set id, or the manual chain's root id. */
  flightId: string;
  flightName: string;
  runStart: string | null;
  runEnd: string | null;
  /** The month the full flight invoices in. */
  billedMonth: string;
  /** Full flight spend across every month it touched (the run, not the slices). */
  flightTotal: number;
  /**
   * `runSpend − billedDelivery` — everything that delivered OUTSIDE the billed
   * month. Direction-agnostic: it never compares "earlier vs later", so a flight
   * that delivers early and bills late and one that delivers late and bills
   * early come out of the same subtraction.
   */
  originTotal: number;
  /** The billed month's own delivery slice — the other half of the subtraction. */
  billedDelivery: number;
  originSlices: OriginSlice[];
  /**
   * `pending` until the run has finished AND its billed month has been reached;
   * `settled` after. While pending, Out and In are both zero and the origin
   * slice stays counted in its own month — pulling it out early would make the
   * dollars vanish from every month until the billed month arrives.
   */
  status: 'pending' | 'settled';
  /** True when Out/In were read from the stored settlement snapshot (§5). */
  fromSnapshot: boolean;
  /**
   * The ad row a settlement snapshot should be written to, when this flight has
   * settled and has none yet. Null when already snapshotted or still pending.
   */
  snapshotAdId: string | null;
  /** Excluded from the rollup and the tie-out — a human has to look (§8). */
  needsReview: boolean;
  reviewReason: FlightReviewReason | null;
  /** Meta's lifetime budget for the run, when synced — the adherence baseline. */
  budgetCap: number | null;
  /**
   * A settled lifetime flight computing OVER its Meta lifetime budget: Meta does
   * not allow lifetime overspend, so this signals a bad split entry rather than
   * real spend.
   */
  exceedsBudgetCap: boolean;
  /**
   * Σ of the flight's own month rows when they cover the whole span and
   * disagree with the full run by more than a cent, else null. The full run is
   * now the basis; a disagreement means a month row is stale, so surface it
   * instead of silently trusting either.
   */
  runSpendMismatch: number | null;
}

/** Per-month rollup of the ledger. */
export interface CrossMonthRollup {
  /** Σ settled origin slices LEAVING this month. */
  out: number;
  /** Σ settled origin slices ARRIVING in this month (flights billed here). */
  in: number;
  /** Σ UNSETTLED origin slices sitting in this month's raw — informational. */
  pendingForward: number;
  /**
   * Σ UNSETTLED origin totals whose flight is BILLED here. Counted already
   * places a marked run in its billed month the moment the mark is made, but
   * Out/In deliberately wait for settlement — so this is what the tie-out backs
   * out to keep a pending flight from reading as a data gap at both ends.
   */
  pendingIn: number;
  /** The flight lines behind the three cells above (drill-down). */
  lines: CrossMonthLine[];
}

/** One drill-down line under a month's Out / In / Pending cell. */
export interface CrossMonthLine {
  flightId: string;
  flightName: string;
  runStart: string | null;
  runEnd: string | null;
  billedMonth: string;
  flightTotal: number;
  /** This month's contribution: the slice leaving, or the total arriving. */
  amount: number;
  status: 'pending' | 'settled';
  /** `out` = leaving this month, `in` = arriving here, `pending` = will leave. */
  direction: 'out' | 'in' | 'pending';
}

/** The conservation invariant. */
export interface ConservationCheck {
  sumOut: number;
  sumIn: number;
  /** Dollars arriving in-window whose origin month sits outside it. */
  carryIn: number;
  /** Dollars leaving in-window for a billed month outside it. */
  carryOut: number;
  /** Σ In − (Σ Out + carryIn − carryOut). Zero when every dollar lands once. */
  delta: number;
  balanced: boolean;
}

/**
 * Which month does this flight invoice in? Members should agree; take the
 * latest non-null so a partially-marked chain resolves deterministically.
 */
function billedMonthOf(members: LedgerAdLike[]): string | null {
  let billed: string | null = null;
  for (const m of members) {
    const v = m.fullRunAppliedToMonth;
    if (v && (billed == null || v > billed)) billed = v;
  }
  return billed;
}

/**
 * Build the ledger: one entry per cross-month flight among `ads`.
 *
 * `ads` must be every row in the reconciliation window (all months), because a
 * flight's origin months and its billed month may live in different rows — and
 * for a two-month straddle, often only the billed month has a row at all. That
 * is exactly why Out/In come from the ROW SUBTRACTION
 * (`pacerRunSpend − pacerActual`) rather than from sibling rows: the full run is
 * on every synced row of the ad set, so the origin total is knowable from the
 * billed row alone.
 */
export function buildFlightLedger(
  ads: LedgerAdLike[],
  nowMs: number,
  timeZone: string,
): FlightLedgerEntry[] {
  const today = zonedTodayIso(nowMs, timeZone);
  const thisMonth = today.slice(0, 7);
  const ledger: FlightLedgerEntry[] = [];

  for (const [flightId, members] of groupFlightRuns(ads)) {
    const billedMonth = billedMonthOf(members);
    if (!billedMonth) continue; // no billing choice recorded — not our business

    const runStart = members.reduce<string | null>((min, m) => {
      const s = m.metaStartDate ?? m.flightStart ?? m.liveDate;
      return s && (min == null || s < min) ? s : min;
    }, null);
    const runEnd = members.reduce<string | null>((max, m) => {
      const e = runEndIso(m, m.period);
      return e && (max == null || e > max) ? e : max;
    }, null);

    // Every calendar month the flight touches: its date span, plus any month it
    // actually has a row in (a row is evidence of delivery even when the dates
    // are missing or were edited after the fact).
    const touched = new Set<string>(monthsInSpan(runStart, runEnd));
    for (const m of members) touched.add(m.period);
    touched.add(billedMonth);
    // A single-month flight has no spill: billing it "in its own month" is the
    // plain case, not a cross-month posting. Skip before any run-spend
    // requirement, so an ordinary resolved straddler never asks for review.
    if (touched.size <= 1) continue;

    const billedRow = members.find((m) => m.period === billedMonth) ?? null;
    const sliceRows = new Map(members.map((m) => [m.period, m]));

    // Snapshot first (rebuild §5): once settled, the two inputs are frozen so a
    // later re-sync or a pruned daily series can't move a posted figure.
    const snapshotRow = members.find((m) => m.settledRunSpend != null) ?? null;
    const snapRun = moneyOrNull(snapshotRow?.settledRunSpend);
    const snapBilled = moneyOrNull(snapshotRow?.settledBilledDelivery);
    const fromSnapshot = snapRun != null;

    // Live inputs: the ad set's all-time full-run spend, and the billed month's
    // own delivery slice.
    const liveRunRow = members.find((m) => m.pacerRunSpend != null) ?? null;
    const liveRun = moneyOrNull(liveRunRow?.pacerRunSpend);
    const liveBilled = billedRow ? cents(money(billedRow.pacerActual)) : 0;

    const runSpend = fromSnapshot ? (snapRun as number) : liveRun;
    const billedDelivery = fromSnapshot ? (snapBilled ?? 0) : liveBilled;

    // Settlement trigger: run complete AND billed month reached.
    const settled = runEnd != null && runEnd < today && billedMonth <= thisMonth;
    const status: 'pending' | 'settled' = settled ? 'settled' : 'pending';

    const capMember = members.find((m) => m.metaLifetimeBudget != null);
    const budgetCap = capMember ? money(capMember.metaLifetimeBudget) : null;
    const sliceSum = cents(
      members.reduce((sum, m) => sum + money(m.pacerActual), 0),
    );
    // The rows only corroborate the run when they cover every month it touched;
    // otherwise a missing origin row would masquerade as a Meta disagreement.
    const rowsCoverSpan = Array.from(touched).every((mo) => sliceRows.has(mo));

    const flag = (reason: FlightReviewReason): void => {
      ledger.push({
        flightId,
        flightName: members.find((m) => m.name)?.name ?? '',
        runStart,
        runEnd,
        billedMonth,
        flightTotal: runSpend ?? sliceSum,
        originTotal: 0,
        billedDelivery,
        originSlices: [],
        status,
        fromSnapshot,
        snapshotAdId: null,
        needsReview: true,
        reviewReason: reason,
        budgetCap,
        exceedsBudgetCap: false,
        runSpendMismatch: null,
      });
    };

    // §12.7 — never silently compute originTotal = 0 from a missing run figure.
    if (runSpend == null) {
      flag('missing_run_spend');
      continue;
    }
    // Counted places the full run on the billed month via `effectiveActual`,
    // which needs a ROW in that month. Without one the run is counted nowhere,
    // and an In posted there would be pure invention.
    if (!billedRow) {
      flag('billed_month_has_no_row');
      continue;
    }

    const originTotal = cents(runSpend - billedDelivery);
    // Rounding noise, or a flight that really did deliver only in its billed
    // month despite spanning the boundary. Nothing to move.
    if (Math.abs(originTotal) <= EPSILON) continue;

    const originMonths = Array.from(touched)
      .filter((mo) => mo !== billedMonth)
      .sort();

    // Place the lump. One origin month: it IS the lump, correct and complete.
    let originSlices: OriginSlice[] = [];
    if (originMonths.length === 1) {
      originSlices = [
        {
          month: originMonths[0],
          datedSpend: originTotal,
          adId: sliceRows.get(originMonths[0])?.id ?? billedRow.id,
        },
      ];
    } else {
      // Three-plus calendar months (rebuild §8). The subtraction gives one lump
      // and cannot split it. The flight's OWN month rows can — but only if they
      // exist for every origin month and add up to the lump. That is not the
      // deferred daily-series split; it is data already on the row, and it is
      // corroborated before use. Anything else raises its hand.
      const rows = originMonths.map((mo) => sliceRows.get(mo));
      const complete = rows.every((r) => r != null);
      const rowSum = complete
        ? cents(rows.reduce((s, r) => s + money(r!.pacerActual), 0))
        : null;
      if (complete && rowSum != null && Math.abs(rowSum - originTotal) <= EPSILON) {
        originSlices = originMonths.map((mo) => ({
          month: mo,
          datedSpend: cents(money(sliceRows.get(mo)!.pacerActual)),
          adId: sliceRows.get(mo)!.id,
        }));
      } else {
        flag('unsplittable_span');
        continue;
      }
    }

    ledger.push({
      flightId,
      flightName: members.find((m) => m.name)?.name ?? '',
      runStart,
      runEnd,
      billedMonth,
      flightTotal: runSpend,
      originTotal,
      billedDelivery,
      originSlices,
      status,
      fromSnapshot,
      // Capture the snapshot the first time it settles, on the billed-month row.
      snapshotAdId: settled && !fromSnapshot ? billedRow.id : null,
      needsReview: false,
      reviewReason: null,
      budgetCap,
      exceedsBudgetCap:
        settled && budgetCap != null && budgetCap > 0
          ? runSpend - budgetCap > EPSILON
          : false,
      runSpendMismatch:
        rowsCoverSpan && Math.abs(sliceSum - runSpend) > EPSILON ? sliceSum : null,
    });
  }
  return ledger;
}

/** One settlement snapshot to persist — the two inputs, never just the Out. */
export interface FlightSnapshotWrite {
  adId: string;
  runSpend: string;
  billedDelivery: string;
}

/**
 * The snapshots a just-built ledger wants written (rebuild §5). Settlement
 * always happens days after run end, deep inside the daily-series retention
 * window, so capturing on the first read after settlement always catches fresh
 * data. Idempotent: a flight that already has a snapshot never appears here.
 */
export function pendingSnapshots(
  ledger: FlightLedgerEntry[],
): FlightSnapshotWrite[] {
  const out: FlightSnapshotWrite[] = [];
  for (const f of ledger) {
    if (!f.snapshotAdId) continue;
    out.push({
      adId: f.snapshotAdId,
      runSpend: f.flightTotal.toFixed(2),
      billedDelivery: f.billedDelivery.toFixed(2),
    });
  }
  return out;
}

/**
 * Roll the ledger up per month. Only SETTLED flights move dollars; a pending
 * flight's slice shows in `pendingForward` and stays counted where it was
 * delivered. Flights flagged for review move nothing at all — their numbers are
 * left out rather than posted to a month that might be wrong.
 */
export function rollupCrossMonth(
  ledger: FlightLedgerEntry[],
  periods: string[],
): Map<string, CrossMonthRollup> {
  const rollup = new Map<string, CrossMonthRollup>();
  for (const p of periods) {
    rollup.set(p, { out: 0, in: 0, pendingForward: 0, pendingIn: 0, lines: [] });
  }
  const at = (month: string): CrossMonthRollup | null => rollup.get(month) ?? null;

  for (const f of ledger) {
    if (f.needsReview) continue;
    const line = {
      flightId: f.flightId,
      flightName: f.flightName,
      runStart: f.runStart,
      runEnd: f.runEnd,
      billedMonth: f.billedMonth,
      flightTotal: f.flightTotal,
      status: f.status,
    };

    for (const slice of f.originSlices) {
      const m = at(slice.month);
      if (!m) continue; // origin month outside the window — see checkConservation
      if (f.status === 'settled') {
        m.out = cents(m.out + slice.datedSpend);
        m.lines.push({ ...line, amount: slice.datedSpend, direction: 'out' });
      } else {
        m.pendingForward = cents(m.pendingForward + slice.datedSpend);
        m.lines.push({ ...line, amount: slice.datedSpend, direction: 'pending' });
      }
    }

    const billed = at(f.billedMonth);
    if (billed && f.originTotal !== 0) {
      if (f.status === 'settled') {
        billed.in = cents(billed.in + f.originTotal);
        billed.lines.push({ ...line, amount: f.originTotal, direction: 'in' });
      } else {
        billed.pendingIn = cents(billed.pendingIn + f.originTotal);
      }
    }
  }
  return rollup;
}

/**
 * The conservation invariant: every dollar pulled out of one month must land in
 * exactly one other. Boundary-aware and direction-agnostic — a flight billed
 * inside the window but delivered outside it produces an In with no matching
 * Out (carry-in), and one delivered inside but billed outside produces the
 * mirror (carry-out), so the identity is
 * `Σ In == Σ Out + carryIn − carryOut`. The origin month may sit either BEFORE
 * the billed month (delivers early, bills late) or AFTER it (delivers late,
 * bills early); neither side of the check looks at month order.
 *
 * A delta that is not zero means a slice is orphaned or double counted. The
 * reconciliation should be FLAGGED, not silently passed.
 */
export function checkConservation(
  ledger: FlightLedgerEntry[],
  periods: string[],
): ConservationCheck {
  const inWindow = new Set(periods);
  let sumOut = 0;
  let sumIn = 0;
  let carryIn = 0;
  let carryOut = 0;

  for (const f of ledger) {
    if (f.needsReview) continue; // excluded from auto-reconciliation entirely
    if (f.status !== 'settled') continue; // pending moves nothing
    const billedInWindow = inWindow.has(f.billedMonth);
    for (const slice of f.originSlices) {
      if (inWindow.has(slice.month)) {
        sumOut = cents(sumOut + slice.datedSpend);
        // Left a window month for a billed month beyond the window.
        if (!billedInWindow) carryOut = cents(carryOut + slice.datedSpend);
      } else if (billedInWindow) {
        // Arrives in-window from a month outside it — route through carry-in so
        // the identity balances.
        carryIn = cents(carryIn + slice.datedSpend);
      }
    }
    if (billedInWindow) sumIn = cents(sumIn + f.originTotal);
  }
  const delta = cents(sumIn - (sumOut + carryIn - carryOut));
  return {
    sumOut,
    sumIn,
    carryIn,
    carryOut,
    delta,
    balanced: Math.abs(delta) <= EPSILON,
  };
}

/** One month's audit row: two independent totals, and the check between them. */
export interface CountedSpendRow {
  /** The ACCOUNT's own spend for the month, from Meta. Never adjusted. */
  rawSpend: number;
  out: number;
  in: number;
  /** `raw − out + in` — raw restated onto the billed basis, for the CHECK only. */
  tieOut: number;
  /** Σ `effectiveActual` over the linked rows. Independently sourced. */
  countedSpend: number;
  /** `tieOut − counted`, with pending flights netted out. 0 = clean; ≠ 0 =
   *  "in account, not in Loomi". */
  residual: number;
  pendingForward: number;
}

/**
 * Compose one month's row: the two independent totals plus the tie-out between
 * them.
 *
 * `rawSpend` is the ACCOUNT-level monthly spend Meta reports — not a sum of the
 * pacer rows. `countedSpend` is Σ `effectiveActual` over the rows. Passing a
 * row-derived figure for `rawSpend` makes the residual identically zero and the
 * check worthless, which is the exact failure this rebuild removed.
 */
export function countedSpendRow(
  rawSpend: number,
  countedSpend: number,
  rollup: CrossMonthRollup | undefined,
): CountedSpendRow {
  const out = rollup?.out ?? 0;
  const incoming = rollup?.in ?? 0;
  const pendingOut = rollup?.pendingForward ?? 0;
  const pendingIn = rollup?.pendingIn ?? 0;
  const raw = cents(rawSpend);
  const counted = cents(countedSpend);
  const tieOut = cents(raw - out + incoming);
  // Counted moves a marked run into its billed month immediately; Out/In wait
  // for settlement. Netting the pending pair back out is what "a pending slice
  // does not enter the tie-out" means arithmetically — without it, every
  // in-flight cross-month flight would read as a gap at BOTH ends.
  const countedSettledBasis = cents(counted + pendingOut - pendingIn);
  return {
    rawSpend: raw,
    out,
    in: incoming,
    tieOut,
    countedSpend: counted,
    residual: cents(tieOut - countedSettledBasis),
    pendingForward: pendingOut,
  };
}

/**
 * Fallback raw for a month with no account-level pull (Google, or a Meta month
 * never fetched): Σ the month's own dated spend. Deliberately NOT
 * `effectiveActual` — it must stay the number reported for the month, with no
 * cross-month substitution folded in. A month raw'd this way is NOT independent
 * of Counted, so it must be excluded from the tie-out rather than reported as
 * clean.
 */
export function rawMonthSpend(adsInMonth: { pacerActual?: string | null }[]): number {
  return cents(adsInMonth.reduce((sum, a) => sum + money(a.pacerActual), 0));
}

/**
 * Counted spend for a month: Σ `effectiveActual` over its rows — the full run
 * lands once, in the billed month, and 0 in every origin month. This is the
 * basis the over/under measures against, and it is sourced from the rows alone.
 */
export function countedMonthSpend(
  adsInMonth: LedgerAdLike[],
  month: string,
): number {
  return cents(adsInMonth.reduce((sum, a) => sum + effectiveActual(a, month), 0));
}
