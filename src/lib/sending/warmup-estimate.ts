/**
 * Warm-up send-duration arithmetic, with no Prisma import.
 *
 * Split out of ./warmup.ts so the blast schedule step — a client component —
 * can share the exact function the server uses instead of carrying its own
 * copy. warmup.ts re-exports it, so server callers don't need to know.
 */

/**
 * How many calendar days a send of `audience` recipients will take, starting
 * today, given a ramp position.
 *
 * Answers the question the schedule step needs — "this 8,400-person blast will
 * take about 12 days" — so a warm-up-limited send says so BEFORE it's
 * scheduled rather than looking stuck for a fortnight.
 *
 * `remainingToday` is passed separately from the schedule because today is
 * usually part-spent; every later day gets its full rung. Days past the end of
 * the ramp are unlimited, so anything still outstanding clears on the first of
 * them — that is why this can't just divide.
 *
 * Returns 1 for an audience that fits in what's left today, and null when there
 * is nothing to estimate.
 */
export function estimateDaysToSend(
  schedule: readonly number[],
  dayIdx: number,
  remainingToday: number,
  audience: number,
): number | null {
  if (audience <= 0) return null;
  let left = audience - remainingToday;
  if (left <= 0) return 1;

  let days = 1;
  let index = dayIdx + 1;
  while (left > 0) {
    // Off the end of the ramp the domain is warm and the rest goes at once.
    if (index >= schedule.length) return days + 1;
    left -= schedule[index]!;
    days += 1;
    index += 1;
  }
  return days;
}
