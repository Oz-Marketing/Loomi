/**
 * Cross-month spend ledger — the auditable `Raw → Out → In → Counted` chain for
 * a flight that delivers in one month but invoices in another.
 * Implements docs/reconciliation-crossmonth.md (the cross-month spec).
 *
 * The problem it solves: a flight running Jun 26 – Jul 3 that bills entirely in
 * July has June-dated Meta spend. Count that June spend in June AND let July's
 * invoice carry the whole flight, and the same dollars are counted twice across
 * the year.
 *
 * Design principles the shape of this module enforces (spec §1):
 *  1. Raw Meta spend is IMMUTABLE — it is summed straight from the month's rows
 *     and never adjusted. Every other number is checked against it.
 *  2. Every adjustment is a visible line (`Out`/`In`), never a silent edit to
 *     raw. `effectiveActual` already substituted the full run for the month
 *     slice, but opaquely: the month total simply changed with nothing on screen
 *     to explain it. Here the same movement is decomposed so a reader can trace
 *     raw → adjustment → counted.
 *  3. Counted spend is DERIVED (`raw − out + in`), never entered.
 *  4. Out and In post as an atomic pair. That is structural here rather than
 *     transactional: both sides are computed from the same ledger entry in one
 *     pass, so Σ Out can never disagree with Σ In through a partial write. The
 *     conservation check (§5) then verifies the arithmetic end to end.
 *
 * Everything is DERIVED from ad rows — the only stored intent is the billed
 * month (`fullRunAppliedToMonth`, "count this run in month X"). Slice amounts,
 * pending/settled status, and the rollups are all recomputed on read, so there
 * is no second copy of the truth to drift, and no migration to get wrong.
 */

import {
  effectiveActual,
  groupFlightRuns,
  runEndIso,
  type SplitRunAdLike,
} from './pacer-calc';
import { zonedTodayIso } from '@/lib/timezone';

/** A flight's month row. `name` labels the drill-down; the rest is the run. */
export type LedgerAdLike = SplitRunAdLike & { name?: string | null };

const money = (s: string | null | undefined): number => {
  if (s == null || s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** Round to cents so summed slices compare exactly against the spec's tables. */
const cents = (n: number): number => Math.round(n * 100) / 100;

/** Money equality at cent tolerance — the whole module's comparison rule. */
export const EPSILON = 0.005;

/** One pre-bill month's dated spend for a flight (spec §3 `origin_slices[]`). */
export interface OriginSlice {
  /** YYYY-MM the spend is DATED to by Meta (delivery), not billed to. */
  month: string;
  /** The Meta-dated spend that fell in this month. */
  datedSpend: number;
  /** The ad row this slice came from — the drill-down's anchor. */
  adId: string;
}

/** One cross-month flight (spec §3). Derived; nothing here is stored as-is. */
export interface FlightLedgerEntry {
  /** Stable per-flight key: the Meta ad-set id, or the manual chain's root id. */
  flightId: string;
  flightName: string;
  runStart: string | null;
  runEnd: string | null;
  /** The month the full flight invoices in. */
  billedMonth: string;
  /** Full flight spend across every month it touched. */
  flightTotal: number;
  originSlices: OriginSlice[];
  /**
   * `pending` until the run has finished AND its billed month has been reached;
   * `settled` after. While pending, Out and In are both zero and the origin
   * slice stays counted in its own month (spec §4) — pulling it out early would
   * make the dollars vanish from every month until the billed month arrives.
   */
  status: 'pending' | 'settled';
  /** Meta's lifetime budget for the run, when synced — the adherence baseline. */
  budgetCap: number | null;
  /**
   * A settled lifetime flight computing OVER its Meta lifetime budget: Meta does
   * not allow lifetime overspend, so this signals a bad split entry rather than
   * real spend (spec §8a "sanity flag to build").
   */
  exceedsBudgetCap: boolean;
  /**
   * Meta's own full-run figure (`pacerRunSpend`) when it disagrees with the
   * summed month slices by more than a cent, else null. The slices are the
   * ledger's basis (they make conservation exact); a disagreement means a month
   * row is missing or stale, so surface it instead of silently trusting either.
   */
  runSpendMismatch: number | null;
}

/** Per-month rollup of the ledger (spec §2 columns 6, 7, 10). */
export interface CrossMonthRollup {
  /** Σ settled origin slices LEAVING this month. */
  out: number;
  /** Σ settled origin slices ARRIVING in this month (flights billed here). */
  in: number;
  /** Σ UNSETTLED origin slices sitting in this month's raw — informational. */
  pendingForward: number;
  /** The flight lines behind the three cells above (spec §6 drill-down). */
  lines: CrossMonthLine[];
}

/** One drill-down line under a month's Out / In / Pending cell (spec §6). */
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

/** The trust check (spec §5). */
export interface ConservationCheck {
  sumOut: number;
  sumIn: number;
  /** Dollars arriving in-window whose origin month sits before it. */
  carryIn: number;
  /** Dollars leaving in-window for a billed month after it. */
  carryOut: number;
  /** Σ In − (Σ Out + carryIn − carryOut). Zero when every dollar lands once. */
  delta: number;
  balanced: boolean;
}

/**
 * Is this flight cross-month? Spec §3: key on the CROSS-MONTH billing choice,
 * never on the lifetime flag — the two are independent (a run can be cross-month
 * without being lifetime and vice versa; `lifetime` drives pacing suppression,
 * this drives settlement).
 *
 * A flight qualifies only when its billed month differs from a month it actually
 * delivered in. A flight billed in its own single run month has no spill, so it
 * gets no ledger record and contributes Out/In = 0 (spec §7).
 */
function billedMonthOf(members: LedgerAdLike[]): string | null {
  // Members should agree; take the latest non-null so a partially-marked chain
  // resolves deterministically (billing can only be at or after delivery).
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
 * flight's origin slice and its billed month live in different rows.
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
    if (!billedMonth) continue; // not billed cross-month — no ledger record
    // Origin slices = every pre-bill month the flight delivered in. A flight
    // whose only month IS the billed month has none, so it is not cross-month.
    const originSlices: OriginSlice[] = members
      .filter((m) => m.period < billedMonth)
      .map((m) => ({
        month: m.period,
        datedSpend: cents(money(m.pacerActual)),
        adId: m.id,
      }));
    if (originSlices.length === 0) continue; // §7: billed in its own run month

    const runStart = members.reduce<string | null>((min, m) => {
      const s = m.metaStartDate ?? m.flightStart ?? m.liveDate;
      return s && (min == null || s < min) ? s : min;
    }, null);
    const runEnd = members.reduce<string | null>((max, m) => {
      const e = runEndIso(m, m.period);
      return e && (max == null || e > max) ? e : max;
    }, null);

    // The slices ARE the basis: flightTotal is their sum plus the billed month's
    // own delivery, so `Σ Out == In` holds by construction for this flight.
    const flightTotal = cents(
      members.reduce((sum, m) => sum + money(m.pacerActual), 0),
    );

    // Spec §4 trigger: run_end has passed AND billed_month has been reached.
    const settled = runEnd != null && runEnd < today && billedMonth <= thisMonth;

    const capMember = members.find((m) => m.metaLifetimeBudget != null);
    const budgetCap = capMember ? money(capMember.metaLifetimeBudget) : null;

    // Meta's full-run figure, when it has one, cross-checked against the slices.
    const runSpendMember = members.find((m) => m.pacerRunSpend != null);
    const metaRunSpend = runSpendMember ? cents(money(runSpendMember.pacerRunSpend)) : null;
    const runSpendMismatch =
      metaRunSpend != null && Math.abs(metaRunSpend - flightTotal) > EPSILON
        ? metaRunSpend
        : null;

    ledger.push({
      flightId,
      flightName: members.find((m) => m.name)?.name ?? '',
      runStart,
      runEnd,
      billedMonth,
      flightTotal,
      originSlices,
      status: settled ? 'settled' : 'pending',
      budgetCap,
      exceedsBudgetCap:
        settled && budgetCap != null && budgetCap > 0
          ? flightTotal - budgetCap > EPSILON
          : false,
      runSpendMismatch,
    });
  }
  return ledger;
}

/**
 * Roll the ledger up per month (spec §3). Only SETTLED flights move dollars;
 * a pending flight's slice shows in `pendingForward` and stays counted where it
 * was delivered.
 */
export function rollupCrossMonth(
  ledger: FlightLedgerEntry[],
  periods: string[],
): Map<string, CrossMonthRollup> {
  const rollup = new Map<string, CrossMonthRollup>();
  for (const p of periods) {
    rollup.set(p, { out: 0, in: 0, pendingForward: 0, lines: [] });
  }
  const at = (month: string): CrossMonthRollup | null => rollup.get(month) ?? null;

  for (const f of ledger) {
    const line = {
      flightId: f.flightId,
      flightName: f.flightName,
      runStart: f.runStart,
      runEnd: f.runEnd,
      billedMonth: f.billedMonth,
      flightTotal: f.flightTotal,
      status: f.status,
    };
    const originTotal = cents(
      f.originSlices.reduce((sum, s) => sum + s.datedSpend, 0),
    );

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

    if (f.status === 'settled' && originTotal !== 0) {
      const billed = at(f.billedMonth);
      if (billed) {
        billed.in = cents(billed.in + originTotal);
        billed.lines.push({ ...line, amount: originTotal, direction: 'in' });
      }
    }
  }
  return rollup;
}

/**
 * The conservation invariant (spec §5): every dollar pulled out of one month
 * must land in exactly one other. Boundary-aware — a flight billed inside the
 * window but delivered before it produces an In with no matching Out (carry-in),
 * and one delivered inside but billed after it produces the mirror (carry-out),
 * so the identity is `Σ In == Σ Out + carryIn − carryOut`.
 *
 * A delta that is not zero means a slice is orphaned or double counted. The
 * reconciliation should be FLAGGED, not silently passed — this check is the
 * answer to "can I trust the counted number".
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
    if (f.status !== 'settled') continue; // pending moves nothing
    const billedInWindow = inWindow.has(f.billedMonth);
    for (const slice of f.originSlices) {
      if (inWindow.has(slice.month)) {
        sumOut = cents(sumOut + slice.datedSpend);
        // Left a window month for a billed month beyond the window.
        if (!billedInWindow) carryOut = cents(carryOut + slice.datedSpend);
      } else if (billedInWindow) {
        // Arrives in-window from a month before it — route through carry-in so
        // the identity balances (the spec's "starting carry-in" bucket).
        carryIn = cents(carryIn + slice.datedSpend);
      }
    }
    if (billedInWindow) {
      sumIn = cents(
        sumIn + f.originSlices.reduce((s, x) => s + x.datedSpend, 0),
      );
    }
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

/** One month's audit row: the spec §2 chain, raw anchored and counted derived. */
export interface CountedSpendRow {
  /** Immutable: Σ the month's own dated spend, exactly as Meta reported it. */
  rawSpend: number;
  out: number;
  in: number;
  /** `raw − out + in`. Never entered. */
  countedSpend: number;
  pendingForward: number;
}

/**
 * Compose one month's Raw → Out → In → Counted row.
 *
 * `rawSpend` must be the month's UNADJUSTED slice total (Σ `pacerActual`), not
 * `Σ effectiveActual` — the latter has already had the cross-month substitution
 * applied, so feeding it in here would apply the adjustment twice.
 */
export function countedSpendRow(
  rawSpend: number,
  rollup: CrossMonthRollup | undefined,
): CountedSpendRow {
  const out = rollup?.out ?? 0;
  const incoming = rollup?.in ?? 0;
  return {
    rawSpend: cents(rawSpend),
    out,
    in: incoming,
    countedSpend: cents(rawSpend - out + incoming),
    pendingForward: rollup?.pendingForward ?? 0,
  };
}

/**
 * The month's raw (unadjusted) spend from its own rows. Deliberately NOT
 * `effectiveActual` — raw is the anchor every adjustment is measured against,
 * and must stay the number Meta reported for the month.
 */
export function rawMonthSpend(adsInMonth: { pacerActual?: string | null }[]): number {
  return cents(adsInMonth.reduce((sum, a) => sum + money(a.pacerActual), 0));
}

/**
 * Sanity bridge for rollout: what the pre-ledger code counted for a month
 * (Σ `effectiveActual`). Once every cross-month flight is settled this equals
 * `countedSpend`; while any is pending they differ by the pending slices, which
 * is the intended behaviour change (spec §4 — a pending slice stays counted in
 * its origin month instead of vanishing from every month).
 */
export function legacyCountedSpend(
  adsInMonth: LedgerAdLike[],
  month: string,
): number {
  return cents(adsInMonth.reduce((sum, a) => sum + effectiveActual(a, month), 0));
}
