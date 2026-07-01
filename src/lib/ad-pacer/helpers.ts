/**
 * Pure formatting + parsing helpers shared by the Meta Ad Planner / Pacer
 * pages. No React, no DOM. Date strings throughout the tool are local-time
 * `YYYY-MM-DD` to mirror `<input type="date">`.
 */

import { toIso } from '@/components/ui/date-picker';
import { randomUUID } from './random-id';
import { COLORS } from './constants';
import type { PacerAd } from './types';

export function fmt(val: number | string | null | undefined): string {
  const n = Number(val ?? 0);
  if (isNaN(n)) return '$0.00';
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/** Days inclusive between two ISO dates. Returns 0 if either is missing. */
export function calcDays(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  return Math.max(
    0,
    Math.ceil(
      (new Date(end).getTime() - new Date(start).getTime()) / 86400000,
    ) + 1,
  );
}

/** Days between flight start and "today" (clamped to flight window). */
export function calcElapsed(start: string | null, end: string | null): number {
  if (!start) return 0;
  const startMs = new Date(start + 'T00:00:00').getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const endMs = end ? new Date(end + 'T00:00:00').getTime() : todayMs;
  const cap = Math.min(todayMs, endMs);
  if (cap < startMs) return 0;
  return Math.ceil((cap - startMs) / 86400000) + 1;
}

/** Walk back n business days from an ISO date (used for Due Date auto-calc). */
export function subtractBusinessDays(dateStr: string, n: number): string {
  // Walks in local time so the returned ISO matches the calendar day the
  // user sees in their browser; using toISOString() here would silently roll
  // forward a day for users east of UTC.
  const d = new Date(dateStr + 'T00:00:00');
  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return toIso(d);
}

/** Default Due Date = 2 business days before flight start. */
export function autoDueDateFromFlightStart(
  flightStart: string | null,
): string | null {
  if (!flightStart) return null;
  return subtractBusinessDays(flightStart, 2);
}

export type DueDateUrgency = {
  level: 'overdue' | 'today' | 'soon' | 'upcoming';
  daysFromNow: number;
};

export function classifyDueDate(ad: PacerAd): DueDateUrgency | null {
  if (!ad.dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(ad.dueDate + 'T00:00:00');
  const diff = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { level: 'overdue', daysFromNow: diff };
  if (diff === 0) return { level: 'today', daysFromNow: 0 };
  if (diff <= 3) return { level: 'soon', daysFromNow: diff };
  if (diff <= 7) return { level: 'upcoming', daysFromNow: diff };
  return null;
}

export function num(s: string | null | undefined): number | null {
  if (s == null || s === '') return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

export const newAdId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : randomUUID();

export function makeAd(position: number, period: string): PacerAd {
  return {
    id: newAdId(),
    position,
    name: '',
    period,
    ownerUserId: null,
    designerUserId: null,
    accountRepUserId: null,
    actionNeeded: null,
    recurring: 'No',
    coop: 'No',
    budgetType: 'Daily',
    budgetSource: 'base',
    splitBaseAmount: null,
    flightStart: null,
    flightEnd: null,
    liveDate: null,
    creativeDueDate: null,
    dueDate: null,
    dateCompleted: null,
    adStatus: 'Working on it',
    designStatus: 'Not Started',
    internalApproval: 'Pending Approval',
    clientApproval: 'Pending Approval',
    allocation: null,
    pacerActual: null,
    pacerDailyBudget: null,
    pacerTodayDate: null,
    pacerEndDate: null,
    creativeLink: null,
    clientName: null,
    digitalDetails: null,
    metaObjectType: null,
    metaObjectId: null,
    metaEffectiveStatus: null,
    pacerSyncedAt: null,
    pacerRunSpend: null,
    metaLifetimeBudget: null,
    fullRunAppliedToMonth: null,
    lifetimeMonthSplit: null,
    linkedPrevAdId: null,
    metaStartDate: null,
    metaEndDate: null,
    alertsMuted: false,
    designNotes: [],
    activityLog: [],
  };
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Bare fractional-days number for display — 2 decimals so a partial first/last
 * day is visible (and the recommended-daily / projected math reconciles on
 * screen), with trailing zeros trimmed so clean days stay tidy: 1.0183 →
 * "1.02", 2 → "2", 2.5 → "2.5". The math itself keeps full precision
 * (PacerCalc.daysLeft); we only round for display, never re-sum the rounded value.
 */
export function fmtDaysNum(days: number): string {
  const rounded = Math.round(days * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0$/, '');
}

/**
 * Fractional days-remaining with a unit, e.g. "1.02 days" / "2 days". Because
 * a near-whole day like 1.02 no longer collapses to a misleading "1 day", the
 * "remaining ÷ days = recommended daily" relationship is visible to the user.
 */
export function fmtDaysLeft(days: number): string {
  return `${fmtDaysNum(days)} day${Math.round(days * 100) / 100 === 1 ? '' : 's'}`;
}

/**
 * Higher-precision day count for the Rec. Daily "basis" line that shows *why*
 * the recommendation is what it is. Normal values read at 2 decimals ("5.34"),
 * but a value a hair over a whole day — e.g. 1.0032, which 2 decimals would
 * hide as "1.00" and the headline shows as a flat "1 day" — bumps to 4
 * decimals so `remaining ÷ days` visibly reconciles with the shown number.
 * Trailing zeros trimmed.
 */
export function fmtDaysBasis(days: number): string {
  const r2 = Math.round(days * 100) / 100;
  const decimals = Number.isInteger(r2) && !Number.isInteger(days) ? 4 : 2;
  return days.toFixed(decimals).replace(/\.?0+$/, '');
}

/** "1.0032 days" / "1 day" — the divisor phrase for the Rec. Daily basis. */
export function fmtDaysBasisPhrase(days: number): string {
  const n = fmtDaysBasis(days);
  return `${n} day${n === '1' ? '' : 's'}`;
}

/** Reformat a YYYY-MM-DD ISO date into the user-facing MM-DD-YYYY layout. */
export const fmtFullDate = (d: string | null | undefined): string => {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return d;
  return `${m}-${day}-${y}`;
};

/** Compact "synced 2h ago" relative time from an ISO timestamp. */
export function fmtSyncedAgo(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// §0.1: the client never holds a markup literal. The server resolves the
// per-account factor (Account.markup override, else the agency default) and
// sends it on the plan / period / overview payloads; this just normalizes a
// possibly-missing value, guarding it to 0 so an unconfigured markup surfaces
// as $0 rather than a plausible-but-wrong number.
export const effMarkupOf = (markup: number | null | undefined): number =>
  typeof markup === 'number' && Number.isFinite(markup) && markup > 0 ? markup : 0;

// Display helpers for the three budget sources (Base / Added / Split).
// Centralized so adding a new source later only touches one place, and
// so the Split tint stays consistent with the lifetime/violet accent
// used in the ad editor.
export function sourceLabel(s: 'base' | 'added' | 'split'): string {
  return s === 'base' ? 'Base' : s === 'added' ? 'Added' : 'Split';
}
export function sourceColor(s: 'base' | 'added' | 'split'): string {
  return s === 'base'
    ? COLORS.base
    : s === 'added'
      ? COLORS.added
      : COLORS.split;
}
export function sourceTint(s: 'base' | 'added' | 'split'): string {
  return s === 'base'
    ? 'rgba(56,189,248,0.18)'
    : s === 'added'
      ? 'rgba(52,211,153,0.18)'
      : 'rgba(244,114,182,0.22)';
}

// Display helpers for the budget TYPE (Daily / Lifetime), mirroring the source
// helpers above. Daily reads yellow, Lifetime violet — centralized so the pill
// text and tint stay paired everywhere a type tag or type-colored figure renders.
export function budgetTypeColor(t: string): string {
  return t === 'Lifetime' ? COLORS.lifetime : '#eab308';
}
export function budgetTypeTint(t: string): string {
  return t === 'Lifetime' ? 'rgba(167,139,250,0.18)' : 'rgba(234,179,8,0.18)';
}

// ─── Run-dates bar coloring (Monday-style) ─────────────────────────────────
// A status-colored progress bar behind the flight window: the elapsed share of
// the run is filled in, the rest is a neutral track. Blue = live/on track (Live /
// Scheduled / Live - Changes Required / Ready- Pending Approval), green = a
// finished run (Completed Run), gray = In Draft / Off, red = needs attention.
export const RUN_DATE_LIVE_STATUSES = new Set([
  'Live',
  'Scheduled',
  'Live - Changes Required',
  'Ready- Pending Approval',
]);
export function runDateColor(status: string): string {
  // Completed reads as done (green); live/on-track reads as in-flight (blue);
  // Off/In Draft as inactive (gray); only attention-worthy statuses get red.
  if (status === 'Completed Run') return COLORS.success; // green
  if (status === 'Off' || status === 'In Draft') return '#9ca3af'; // gray
  return RUN_DATE_LIVE_STATUSES.has(status) ? COLORS.daily : COLORS.error;
}
/** Share (0–100) of the flight window that has elapsed as of today. */
export function flightElapsedPct(
  flightStart: string | null,
  flightEnd: string | null,
): number {
  if (!flightStart || !flightEnd) return 0;
  const start = new Date(flightStart + 'T00:00:00').getTime();
  const end = new Date(flightEnd + 'T23:59:59').getTime();
  if (!(end > start)) return 0;
  const now = Date.now();
  if (now <= start) return 0;
  if (now >= end) return 100;
  return ((now - start) / (end - start)) * 100;
}

// Per-ad contribution to the Base / Added budget pools. For a regular
// single-source ad, the full allocation + pacerActual goes to its source.
// For a "split" ad, the allocation is divided per `splitBaseAmount` and
// the pacerActual is apportioned proportionally — keeping both pools'
// over/under math accurate when one ad is funded from both budgets.
export interface AdSourceContribution {
  baseAllocation: number;
  addedAllocation: number;
  baseSpent: number;
  addedSpent: number;
}

export function adContribution(ad: {
  allocation?: string | null;
  pacerActual?: string | null;
  budgetSource: 'base' | 'added' | 'split';
  splitBaseAmount: string | null;
}): AdSourceContribution {
  const allocation = num(ad.allocation) ?? 0;
  const spent = num(ad.pacerActual) ?? 0;
  if (ad.budgetSource === 'split' && allocation > 0) {
    const baseAlloc = Math.min(
      Math.max(0, num(ad.splitBaseAmount) ?? 0),
      allocation,
    );
    const baseShare = baseAlloc / allocation;
    return {
      baseAllocation: baseAlloc,
      addedAllocation: allocation - baseAlloc,
      baseSpent: spent * baseShare,
      addedSpent: spent * (1 - baseShare),
    };
  }
  if (ad.budgetSource === 'added') {
    return {
      baseAllocation: 0,
      addedAllocation: allocation,
      baseSpent: 0,
      addedSpent: spent,
    };
  }
  return {
    baseAllocation: allocation,
    addedAllocation: 0,
    baseSpent: spent,
    addedSpent: 0,
  };
}

// Pacer row health classification — used by both the compact summary
// row and the expanded card to color the left accent stripe + the
// inline pacing badge. Keeps the buckets in one place so the badge
// label and color always agree with the stripe.
export type PacerHealth =
  | 'over-budget'
  | 'overpacing'
  | 'underpacing'
  | 'on-track'
  | 'stopped'
  | 'no-data';

export interface PacerHealthInfo {
  state: PacerHealth;
  color: string;
  label: string;
  short: string; // 1-2 word tag for compact pills
}

export function classifyPacerHealth(
  ad: { adStatus: string; budgetType: 'Daily' | 'Lifetime' },
  calc: {
    budget: number;
    spent: number;
    projected: number;
    hasDates: boolean;
    endsBeforeToday: boolean;
    lifetimePacingPct: number | null;
  },
): PacerHealthInfo {
  if (ad.adStatus === 'Off' || ad.adStatus === 'Completed Run') {
    return {
      state: 'stopped',
      color: 'var(--border)',
      label: 'Stopped',
      short: 'Off',
    };
  }
  if (calc.budget <= 0 || !calc.hasDates) {
    return {
      state: 'no-data',
      color: 'var(--border)',
      label: 'No pacing data',
      short: 'No data',
    };
  }
  if (calc.spent > calc.budget) {
    return {
      state: 'over-budget',
      color: '#ef4444',
      label: 'Over budget',
      short: 'Over',
    };
  }
  const isLifetime = ad.budgetType === 'Lifetime';
  const pct = isLifetime
    ? calc.lifetimePacingPct
    : calc.projected > 0 && calc.budget > 0
      ? (calc.projected / calc.budget) * 100
      : null;
  if (pct == null) {
    return {
      state: 'no-data',
      color: 'var(--border)',
      label: 'No pacing data',
      short: 'No data',
    };
  }
  if (pct > 105) {
    return {
      state: 'overpacing',
      // Red: projected to overspend (shares red with the already-over-budget
      // state — both are "spending too much", distinguished by their label).
      color: '#ef4444',
      label: 'Overpacing',
      short: 'Overpacing',
    };
  }
  if (pct < 95) {
    return {
      state: 'underpacing',
      // Amber: caution that the budget is on pace to be underspent.
      color: '#f59e0b',
      label: 'Underpacing',
      short: 'Under',
    };
  }
  return {
    state: 'on-track',
    color: '#22c55e',
    label: 'On track',
    short: 'On track',
  };
}
