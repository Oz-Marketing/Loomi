/**
 * Call Tracking — port of Oz Dealer Tools' CallTrackingReport.
 *
 * ODT pulled every call row for a date range out of the `ozreports.calls` table
 * and summarised them in PHP six ways: by status, tracker, city, day of week,
 * hour, and date. Loomi reads `CallEvent`, filled by the new `pushcalls` bridge
 * route, and does the same six summaries — in SQL where the grouping is cheap,
 * and in the folding functions below where the shaping needs to be testable.
 *
 * ── THE SUMMARIES ARE THE PORT ──────────────────────────────────────────────
 * Two of them carry judgment worth stating:
 *
 * `foldTrackers` counts a call as answered on the tracker's own status string,
 * and averages duration over ANSWERED calls only. Averaging over all calls
 * would drag every campaign's average toward zero in proportion to how many
 * calls it missed, which reads as "short conversations" when it actually means
 * "nobody picked up" — two different problems with two different fixes.
 *
 * `foldHours` and `foldDaysOfWeek` return a fixed-length series — 24 hours,
 * 7 days, zeros included. A sparse series would silently omit the 6am with no
 * calls, and a bar chart drawn from it would show a day that never happened.
 *
 * ── LOCAL TIME ──────────────────────────────────────────────────────────────
 * Hour-of-day and day-of-week are the two summaries where UTC is wrong: "we
 * miss calls at 8am" is a claim about the dealership's morning, not about
 * Greenwich. The SQL converts to the account's timezone before extracting the
 * hour; everything else is timezone-agnostic counting.
 */
import { prisma } from '@/lib/prisma';

/** The tracker's own word for the outcome, normalised at ingest. */
export const ANSWERED = 'answered';

export interface StatusCount {
  status: string;
  calls: number;
  share: number;
}

export interface TrackerRow {
  name: string;
  calls: number;
  answered: number;
  missed: number;
  answerRate: number | null;
  /** Mean talk time over ANSWERED calls, seconds. Null when none were answered. */
  avgDuration: number | null;
}

export interface CityRow {
  city: string;
  calls: number;
  share: number;
}

export interface DayRow {
  day: string;
  calls: number;
}
export interface HourRow {
  hour: number;
  calls: number;
}
export interface DateRow {
  date: string;
  calls: number;
  answered: number;
}

export interface CallSummary {
  calls: number;
  answered: number;
  missed: number;
  answerRate: number | null;
  /** Mean talk time over answered calls, seconds. Null when none were answered. */
  avgDuration: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const num = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Monday-first, matching ODT's ordering. */
export const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export function foldStatuses(rows: { status: string | null; calls: number }[]): StatusCount[] {
  const total = rows.reduce((n, r) => n + num(r.calls), 0);
  return rows
    .map((r) => ({
      status: r.status?.trim() || 'unknown',
      calls: num(r.calls),
      share: total > 0 ? num(r.calls) / total : 0,
    }))
    .sort((a, b) => b.calls - a.calls || a.status.localeCompare(b.status));
}

export function foldTrackers(
  rows: { name: string | null; calls: number; answered: number; answeredDuration: number }[],
): TrackerRow[] {
  return rows
    .map((r) => {
      const calls = num(r.calls);
      const answered = num(r.answered);
      return {
        name: r.name?.trim() || 'Unknown',
        calls,
        answered,
        missed: calls - answered,
        answerRate: calls > 0 ? round1((answered / calls) * 100) : null,
        // Over answered calls only — see the file header.
        avgDuration: answered > 0 ? Math.round(num(r.answeredDuration) / answered) : null,
      };
    })
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}

export function foldCities(rows: { city: string | null; calls: number }[]): CityRow[] {
  const total = rows.reduce((n, r) => n + num(r.calls), 0);
  return rows
    .map((r) => ({
      city: r.city?.trim() || 'Unknown',
      calls: num(r.calls),
      share: total > 0 ? num(r.calls) / total : 0,
    }))
    .sort((a, b) => b.calls - a.calls || a.city.localeCompare(b.city));
}

/**
 * Seven days, always, in Monday-first order.
 *
 * `dow` arrives as Postgres' `isodow` (1 = Monday … 7 = Sunday).
 */
export function foldDaysOfWeek(rows: { dow: number; calls: number }[]): DayRow[] {
  const byDow = new Map(rows.map((r) => [Number(r.dow), num(r.calls)]));
  return DAY_NAMES.map((day, i) => ({ day, calls: byDow.get(i + 1) ?? 0 }));
}

/** Twenty-four hours, always, 0–23. */
export function foldHours(rows: { hour: number; calls: number }[]): HourRow[] {
  const byHour = new Map(rows.map((r) => [Number(r.hour), num(r.calls)]));
  return Array.from({ length: 24 }, (_, hour) => ({ hour, calls: byHour.get(hour) ?? 0 }));
}

export function foldDates(rows: { date: string; calls: number; answered: number }[]): DateRow[] {
  return rows
    .map((r) => ({ date: r.date, calls: num(r.calls), answered: num(r.answered) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function summarize(statuses: StatusCount[], answeredDuration: number): CallSummary {
  const calls = statuses.reduce((n, s) => n + s.calls, 0);
  const answered = statuses.find((s) => s.status === ANSWERED)?.calls ?? 0;
  return {
    calls,
    answered,
    missed: calls - answered,
    answerRate: calls > 0 ? round1((answered / calls) * 100) : null,
    avgDuration: answered > 0 ? Math.round(answeredDuration / answered) : null,
  };
}

// ── Queries ──

function bounds(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`);
  const endExclusive = new Date(`${to}T00:00:00Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { start, endExclusive };
}

/**
 * Everything the report needs, in six grouped queries plus one total.
 *
 * `timezone` shifts only the hour and weekday summaries — see the header. It is
 * an IANA name; Postgres validates it and throws on a bad one, so the caller
 * passes a checked value.
 */
export async function getCallTracking(
  accountKey: string,
  from: string,
  to: string,
  timezone: string,
) {
  const { start, endExclusive } = bounds(from, to);
  const where = { accountKey, occurredAt: { gte: start, lt: endExclusive } };

  const [statusRows, trackerRows, cityRows, dowRows, hourRows, dateRows, durationRow] =
    await Promise.all([
      prisma.$queryRaw<{ status: string | null; calls: number }[]>`
        SELECT "status", count(*)::int AS calls
        FROM "CallEvent"
        WHERE "accountKey" = ${accountKey}
          AND "occurredAt" >= ${start} AND "occurredAt" < ${endExclusive}
        GROUP BY 1
      `,
      prisma.$queryRaw<
        { name: string | null; calls: number; answered: number; answeredDuration: number }[]
      >`
        SELECT
          "trackerName" AS name,
          count(*)::int AS calls,
          count(*) FILTER (WHERE "status" = ${ANSWERED})::int AS answered,
          coalesce(sum("durationSeconds") FILTER (WHERE "status" = ${ANSWERED}), 0)::int
            AS "answeredDuration"
        FROM "CallEvent"
        WHERE "accountKey" = ${accountKey}
          AND "occurredAt" >= ${start} AND "occurredAt" < ${endExclusive}
        GROUP BY 1
      `,
      prisma.$queryRaw<{ city: string | null; calls: number }[]>`
        SELECT "callerCity" AS city, count(*)::int AS calls
        FROM "CallEvent"
        WHERE "accountKey" = ${accountKey}
          AND "occurredAt" >= ${start} AND "occurredAt" < ${endExclusive}
        GROUP BY 1
      `,
      // isodow: 1 = Monday … 7 = Sunday, which is why foldDaysOfWeek offsets.
      prisma.$queryRaw<{ dow: number; calls: number }[]>`
        SELECT extract(isodow FROM ("occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}))::int AS dow,
               count(*)::int AS calls
        FROM "CallEvent"
        WHERE "accountKey" = ${accountKey}
          AND "occurredAt" >= ${start} AND "occurredAt" < ${endExclusive}
        GROUP BY 1
      `,
      prisma.$queryRaw<{ hour: number; calls: number }[]>`
        SELECT extract(hour FROM ("occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}))::int AS hour,
               count(*)::int AS calls
        FROM "CallEvent"
        WHERE "accountKey" = ${accountKey}
          AND "occurredAt" >= ${start} AND "occurredAt" < ${endExclusive}
        GROUP BY 1
      `,
      prisma.$queryRaw<{ date: string; calls: number; answered: number }[]>`
        SELECT to_char("occurredAt", 'YYYY-MM-DD') AS date,
               count(*)::int AS calls,
               count(*) FILTER (WHERE "status" = ${ANSWERED})::int AS answered
        FROM "CallEvent"
        WHERE "accountKey" = ${accountKey}
          AND "occurredAt" >= ${start} AND "occurredAt" < ${endExclusive}
        GROUP BY 1
      `,
      prisma.callEvent.aggregate({
        where: { ...where, status: ANSWERED },
        _sum: { durationSeconds: true },
      }),
    ]);

  const byStatus = foldStatuses(statusRows);

  return {
    summary: summarize(byStatus, durationRow._sum.durationSeconds ?? 0),
    byStatus,
    byTracker: foldTrackers(trackerRows),
    byCity: foldCities(cityRows),
    byDayOfWeek: foldDaysOfWeek(dowRows),
    byHour: foldHours(hourRows),
    byDate: foldDates(dateRows),
    timezone,
  };
}
