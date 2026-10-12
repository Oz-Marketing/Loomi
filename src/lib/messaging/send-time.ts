// Time zones for the blast Schedule steps.
//
// The date and time pickers edit a wall-clock time in the BROWSER's zone —
// that is the only zone a `Date` built from picker strings can be in. Nothing
// on the page used to say so, and nothing mentioned the account's own zone, so
// someone in Denver scheduling a Florida dealer's 9 AM blast got a 9 AM Denver
// send with no hint it would land at 11 in the stores' inboxes. These helpers
// name the browser's zone next to the pickers and spell out the account-local
// equivalent when the two differ.
//
// Pure and isomorphic — `Intl` only, every zone passed in explicitly — so the
// tests can pin zones instead of depending on the machine running them.

import { isValidTimeZone } from '@/lib/timezone';

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** The browser's IANA zone, or UTC when the runtime won't say. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * A zone's everyday name — "Mountain Time" — at the given instant. Falls back
 * to the specific name ("Mountain Daylight Time") on runtimes without the
 * generic style, and to the raw id if neither formats.
 */
export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  for (const style of ['longGeneric', 'long'] as const) {
    try {
      const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: style })
        .formatToParts(at)
        .find((p) => p.type === 'timeZoneName');
      if (part?.value) return part.value;
    } catch {
      // This runtime doesn't know the style; try the next one.
    }
  }
  return timeZone;
}

/** `instant` as a wall clock in `timeZone`: `YYYY-MM-DD` and `HH:mm`. */
export function wallClockInZone(
  instant: Date,
  timeZone: string,
): { date: string; time: string } {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  // Some engines report midnight as hour "24" even under h23.
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
  };
}

/** Offset of `timeZone` from UTC at `utcMs`, in ms (positive east of UTC). */
function offsetMs(timeZone: string, utcMs: number): number {
  const { date, time } = wallClockInZone(new Date(utcMs), timeZone);
  const asUtc = Date.parse(`${date}T${time}:00Z`);
  // wallClockInZone drops seconds; put them back so the offset is exact.
  return asUtc - (utcMs - (utcMs % 60_000));
}

/**
 * The instant at which the clock in `timeZone` reads `date` `time`, or null for
 * malformed input. Two passes so a DST change between the guess and the answer
 * is still accounted for. A time that doesn't exist (the hour skipped in
 * spring) lands an hour later, as a browser does with its own local times.
 */
export function instantFromWallClock(
  date: string,
  time: string,
  timeZone: string,
): Date | null {
  const match = WALL_CLOCK.exec(`${date}T${time}`);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(guess)) return null;
  // Date.UTC rolls an impossible date over ("Feb 31" → Mar 3) rather than
  // failing; a send time nobody picked is worse than no send time.
  const check = new Date(guess);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  try {
    const first = guess - offsetMs(timeZone, guess);
    const second = guess - offsetMs(timeZone, first);
    const wanted = `${date}T${time}`;
    const reads = (ms: number) => {
      const clock = wallClockInZone(new Date(ms), timeZone);
      return `${clock.date}T${clock.time}` === wanted;
    };
    if (reads(second)) return new Date(second);
    if (reads(first)) return new Date(first);
    // Neither reads back: the time falls in the hour skipped in spring. Both
    // candidates straddle the gap; the later one is what a browser picks.
    return new Date(Math.max(first, second));
  } catch {
    return null;
  }
}

/** "9:00 AM" for an instant in a zone. */
export function formatClockTime(instant: Date, timeZone: string): string {
  return instant
    .toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
    // Newer ICU puts a narrow no-break space before AM/PM; keep plain text.
    .replace(/ /g, ' ');
}

/**
 * "11:00 AM Eastern Time" — the send time as the account will see it — or
 * null when there's nothing to add: the account has no usable zone, or its
 * clock reads the same as the browser's at that instant. The weekday is
 * included when the two zones disagree on the date, so a late-evening send
 * that lands after midnight for the account says so.
 */
export function accountLocalEquivalent(
  instant: Date,
  accountZone: string | null | undefined,
  browserZone: string,
): string | null {
  if (!isValidTimeZone(accountZone)) return null;
  const there = wallClockInZone(instant, accountZone);
  const here = wallClockInZone(instant, browserZone);
  if (there.date === here.date && there.time === here.time) return null;
  const clock = formatClockTime(instant, accountZone);
  const day =
    there.date !== here.date
      ? `${instant.toLocaleDateString('en-US', { timeZone: accountZone, weekday: 'short' })} `
      : '';
  return `${day}${clock} ${timeZoneLabel(accountZone, instant)}`;
}
