/**
 * Timezone helpers for ad-account-correct date math. Pure + isomorphic
 * (server and client) — built on `Intl`, no external library.
 *
 * Meta resets a campaign's daily budget at midnight in the AD ACCOUNT's
 * configured timezone. That midnight is the boundary that defines "how much
 * of today is still controllable," so the Pacer must measure time-left in
 * that zone — not the viewer's and not the server's. "Now" is always an
 * absolute epoch (timezone-independent); only the day boundaries are zoned.
 */

/** Fallback when an account has no Meta-sourced or valid stored zone. */
export const DEFAULT_TIME_ZONE = 'America/Denver';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `tz` is an IANA zone the runtime's Intl actually understands. */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    // Throws RangeError for unknown zones / non-IANA strings.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick the zone to do pacing math in: the Meta ad-account zone if we have it,
 * else a hand-entered Loomi `Account.timezone` (only if it's a real IANA
 * zone), else the agency default. Never throws — always returns a usable zone.
 */
export function resolveAccountTimeZone(
  metaTimezone: string | null | undefined,
  accountTimezone: string | null | undefined,
  fallback: string = DEFAULT_TIME_ZONE,
): string {
  if (isValidTimeZone(metaTimezone)) return metaTimezone;
  if (isValidTimeZone(accountTimezone)) return accountTimezone;
  return fallback;
}

/**
 * Offset (ms) between `timeZone`'s wall clock and UTC at the given instant.
 * Positive east of UTC. Found by formatting the instant in the zone and
 * reading the wall-clock fields back as if they were UTC.
 */
function tzOffsetMs(timeZone: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') map[part.type] = Number(part.value);
  }
  // Some engines emit hour "24" at midnight under h23 — normalize to 0.
  if (map.hour === 24) map.hour = 0;
  const asUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour,
    map.minute,
    map.second,
  );
  return asUtc - utcMs;
}

/**
 * Absolute epoch (ms) of local midnight `00:00:00` on the given calendar date
 * in `timeZone`. Two-pass offset refinement keeps it correct across DST
 * transitions (the offset can differ on either side of the boundary).
 */
export function zonedMidnightMs(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset = tzOffsetMs(timeZone, guess);
  const refined = tzOffsetMs(timeZone, guess - offset);
  return guess - refined;
}

/**
 * The flight's budget-reset boundary: midnight at the START of the day AFTER
 * the last flight day, in the account zone. A flight ending May 31 returns
 * June 1 00:00:00 (account TZ). Returns null for a malformed date.
 */
export function flightEndBoundaryMs(
  flightEndIso: string | null | undefined,
  timeZone: string,
): number | null {
  if (!flightEndIso) return null;
  const m = ISO_DATE.exec(flightEndIso);
  if (!m) return null;
  // Roll to the next calendar day in UTC (handles month/year wrap), then take
  // that day's midnight in the target zone.
  const next = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return zonedMidnightMs(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  );
}

/**
 * Fractional days from `nowMs` to the flight's reset boundary, measured in
 * `timeZone`. e.g. 6:30 PM on May 29 with a flight ending May 31 → ~2.23.
 * Can be ≤ 0 once the flight is over; callers clamp. null when no end date.
 */
export function fractionalDaysRemaining(
  flightEndIso: string | null | undefined,
  nowMs: number,
  timeZone: string,
): number | null {
  const boundary = flightEndBoundaryMs(flightEndIso, timeZone);
  if (boundary == null) return null;
  return (boundary - nowMs) / 86_400_000;
}

/**
 * First and last calendar day (YYYY-MM-DD) of a `YYYY-MM` period. These are
 * the clamp boundaries the pacer scopes a flight to — note YYYY-MM-DD strings
 * compare lexicographically === chronologically, so callers can `min`/`max`
 * them with plain `<`/`>`. null for a malformed period.
 */
export function monthBoundsIso(
  period: string,
): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  // Day 0 of the next month = last day of this one (date-only UTC math).
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${period}-01`,
    end: `${period}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Zone-local calendar date (YYYY-MM-DD) for an absolute instant. */
export function zonedTodayIso(nowMs: number, timeZone: string): string {
  // en-CA renders as YYYY-MM-DD, which is exactly the ISO date shape the tool
  // uses everywhere else.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs));
}
