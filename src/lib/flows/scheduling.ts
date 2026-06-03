// Pure scheduling helpers for the flow worker. No Prisma / IO so they
// can be unit-tested in isolation. The quiet-hours window math is the
// branchy bit (same-day vs. wrap-past-midnight windows), so it lives
// here rather than buried in the worker module.

import { zonedMidnightMs, zonedTodayIso } from '@/lib/timezone';

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Does a birthday (`dob`) fall on the target calendar date? Compares
 * month/day only (the year is the contact's birth year). `targetIso` is
 * the firing date "YYYY-MM-DD" in the account timezone. Feb-29 birthdays
 * fire on Feb-28 in non-leap years so they're never silently skipped.
 */
export function birthdayMatchesTarget(dob: Date, targetIso: string): boolean {
  const [ty, tm, td] = targetIso.split('-').map(Number);
  const dobMonth = dob.getUTCMonth() + 1;
  const dobDay = dob.getUTCDate();
  if (dobMonth === tm && dobDay === td) return true;
  // Born Feb-29: in a non-leap target year, fire on Feb-28.
  if (dobMonth === 2 && dobDay === 29 && tm === 2 && td === 28 && !isLeapYear(ty)) {
    return true;
  }
  return false;
}

/** Parse "HH:mm" (24h) into milliseconds-since-midnight. null if malformed. */
export function parseHhMm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 3_600_000 + min * 60_000;
}

/**
 * Quiet-hours gate. `[start, end]` (HH:mm, account timezone) is the
 * ALLOWED send window. Returns null when `nowMs` is inside the window
 * (send permitted), otherwise the next instant a send is allowed.
 * Handles windows that wrap past midnight (e.g. 21:00–06:00). Fails open
 * (returns null) on a malformed window so a bad config never strands a
 * contact forever.
 */
export function nextAllowedSendTime(
  nowMs: number,
  timeZone: string,
  start: string,
  end: string,
): Date | null {
  const startOff = parseHhMm(start);
  const endOff = parseHhMm(end);
  if (startOff == null || endOff == null) return null;

  const todayIso = zonedTodayIso(nowMs, timeZone);
  const [y, m, d] = todayIso.split('-').map(Number);
  const midnight = zonedMidnightMs(y, m, d, timeZone);
  const startAt = midnight + startOff;
  const endAt = midnight + endOff;

  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const nextStartAt =
    zonedMidnightMs(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
      timeZone,
    ) + startOff;

  if (startOff <= endOff) {
    // Normal same-day window [start, end].
    if (nowMs < startAt) return new Date(startAt);
    if (nowMs > endAt) return new Date(nextStartAt);
    return null;
  }
  // Window wraps midnight (e.g. 21:00–06:00): allowed at/after start or
  // at/before end; otherwise defer to today's start.
  if (nowMs <= endAt || nowMs >= startAt) return null;
  return new Date(startAt);
}
