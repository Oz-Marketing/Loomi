/**
 * Sending-domain warm-up.
 *
 * A brand-new sending domain that opens with a 20,000-recipient blast gets
 * throttled or filtered by the big mailbox providers, and the damage sticks to
 * the domain long after the campaign is over. The fix is boring: send a little
 * on day one, a bit more each day, and only to people likely to open — which is
 * what actually teaches a provider the mail is wanted.
 *
 * ── WHAT THIS DOES AND DOESN'T DECIDE ───────────────────────────────────────
 * This module owns the ARITHMETIC — what today's cap is and how much of it is
 * left. It never sends, never touches a blast's status, and never decides what
 * happens to recipients that don't fit. The caller (processEmailBlast) leaves
 * them `pending`, which the existing sweep already resumes on the next run, so
 * a capped blast drains over days with no new scheduling machinery.
 *
 * ── OPT-IN, ALWAYS ──────────────────────────────────────────────────────────
 * No row means no cap. Every established domain in the system has no row and is
 * therefore unaffected. This is deliberate and load-bearing: a bug that
 * accidentally created rows would throttle production sending, so the safe
 * state is also the default state.
 */
import { prisma } from '@/lib/prisma';

/**
 * Daily send allowance by day index (0 = the first day of the ramp).
 *
 * Roughly doubling, which is the shape every major provider's guidance
 * describes. Running off the end of this array means the domain has graduated:
 * {@link resolveAllowance} reports no cap from then on.
 *
 * Tune freely — nothing derives meaning from the specific numbers, only from
 * the array being non-decreasing.
 */
export const WARMUP_SCHEDULE: readonly number[] = [
  50, 100, 250, 500, 1_000, 2_000, 4_000, 7_500, 12_000, 20_000, 35_000, 50_000,
  75_000, 100_000,
];

export const WARMUP_DAYS = WARMUP_SCHEDULE.length;

const MS_PER_DAY = 86_400_000;

/**
 * The domain a From address will build reputation on, lowercased. Returns null
 * for anything that isn't a usable address, so callers can treat "no domain" and
 * "no warm-up" the same way.
 */
export function sendingDomain(fromEmail: string | null | undefined): string | null {
  if (!fromEmail) return null;
  const at = fromEmail.lastIndexOf('@');
  if (at < 0 || at === fromEmail.length - 1) return null;
  const domain = fromEmail.slice(at + 1).trim().toLowerCase();
  return domain.length > 0 ? domain : null;
}

/** UTC midnight for a given instant — the day boundary the counter resets on. */
export function utcDayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** Whole days elapsed between two instants, by UTC calendar day. */
export function dayIndex(startedAt: Date, now: Date): number {
  const diff = utcDayStart(now).getTime() - utcDayStart(startedAt).getTime();
  return Math.max(0, Math.floor(diff / MS_PER_DAY));
}

/** The row shape this module needs — a subset of the Prisma model. */
export interface WarmupState {
  domain: string;
  startedAt: Date;
  status: string;
  sentToday: number;
  countedOn: Date | null;
  dailyCapOverride: number | null;
  heldOnDay: number | null;
}

export interface WarmupAllowance {
  domain: string;
  /** Null when the domain is unconstrained (no warm-up, paused, or graduated). */
  dailyCap: number | null;
  /** Sends already counted against today. Zero once the counter has rolled over. */
  usedToday: number;
  /** Null means "as many as you like". Never negative. */
  remaining: number | null;
  /** 1-based for display ("Day 4 of 14"). Null when not warming. */
  day: number | null;
  totalDays: number;
  status: 'none' | 'active' | 'paused' | 'completed';
}

/** An unconstrained result, used for domains with no warm-up row. */
export function unlimitedAllowance(domain: string): WarmupAllowance {
  return {
    domain,
    dailyCap: null,
    usedToday: 0,
    remaining: null,
    day: null,
    totalDays: WARMUP_DAYS,
    status: 'none',
  };
}

/**
 * Today's cap and what's left of it — pure, so the schedule is testable without
 * a database.
 *
 * A `paused` warm-up reports NO cap rather than a cap of zero. Pausing is what
 * an operator does to get mail flowing again after a false alarm; if it meant
 * "send nothing" it would be a strictly worse version of the thing it exists to
 * undo. Stopping sending is what leaving the blast unscheduled is for.
 */
export function resolveAllowance(state: WarmupState, now: Date): WarmupAllowance {
  if (state.status !== 'active') {
    return {
      ...unlimitedAllowance(state.domain),
      status: state.status === 'paused' ? 'paused' : 'completed',
    };
  }

  const index = state.heldOnDay != null
    ? Math.min(state.heldOnDay, dayIndex(state.startedAt, now))
    : dayIndex(state.startedAt, now);

  // Past the end of the ramp the domain is warm; it stops being this module's
  // problem. An explicit override still applies, so a domain can be held below
  // full volume indefinitely if someone wants that.
  if (index >= WARMUP_SCHEDULE.length && state.dailyCapOverride == null) {
    return { ...unlimitedAllowance(state.domain), status: 'completed' };
  }

  const dailyCap = state.dailyCapOverride
    ?? WARMUP_SCHEDULE[Math.min(index, WARMUP_SCHEDULE.length - 1)];

  // A counter from an earlier day is stale, not zero-by-accident: treat it as
  // spent-nothing rather than trusting a number that was never reset.
  const today = utcDayStart(now).getTime();
  const usedToday = state.countedOn && utcDayStart(state.countedOn).getTime() === today
    ? state.sentToday
    : 0;

  return {
    domain: state.domain,
    dailyCap,
    usedToday,
    remaining: Math.max(0, dailyCap - usedToday),
    day: Math.min(index, WARMUP_SCHEDULE.length - 1) + 1,
    totalDays: WARMUP_DAYS,
    status: 'active',
  };
}

/** Allowances for several domains at once. Domains with no row come back unlimited. */
export async function getAllowances(
  domains: string[],
  now: Date = new Date(),
): Promise<Map<string, WarmupAllowance>> {
  const unique = [...new Set(domains.map((d) => d.toLowerCase()).filter(Boolean))];
  const result = new Map<string, WarmupAllowance>();
  if (unique.length === 0) return result;

  const rows = await prisma.emailWarmup.findMany({ where: { domain: { in: unique } } });
  const byDomain = new Map(rows.map((r) => [r.domain, r]));
  for (const domain of unique) {
    const row = byDomain.get(domain);
    result.set(domain, row ? resolveAllowance(row, now) : unlimitedAllowance(domain));
  }
  return result;
}

/**
 * The number of sends permitted RIGHT NOW across every domain a send will use.
 *
 * The minimum wins, not the sum. A blast spanning two accounts sends the same
 * message from both domains, so the warmer domain cannot spend the colder one's
 * budget on its behalf. Returns null only when no domain involved is capped.
 */
export async function getCombinedRemaining(
  domains: string[],
  now: Date = new Date(),
): Promise<number | null> {
  const allowances = await getAllowances(domains, now);
  let min: number | null = null;
  for (const allowance of allowances.values()) {
    if (allowance.remaining == null) continue;
    min = min == null ? allowance.remaining : Math.min(min, allowance.remaining);
  }
  return min;
}

/**
 * Book `count` sends against a domain's daily budget.
 *
 * Reserve BEFORE sending and release what you don't use (see
 * {@link releaseWarmupSends}); counting only after the fact would let two
 * concurrent blasts each read the same remaining budget and both spend it.
 *
 * A no-op for domains with no warm-up row — nothing to count against.
 */
export async function recordWarmupSends(
  domain: string | null,
  count: number,
  now: Date = new Date(),
): Promise<void> {
  if (!domain || count <= 0) return;
  const today = utcDayStart(now);

  // Same-day increment first: this is the common path and it's atomic, so
  // concurrent senders can't lose each other's counts.
  const bumped = await prisma.emailWarmup.updateMany({
    where: { domain: domain.toLowerCase(), countedOn: today },
    data: { sentToday: { increment: count } },
  });
  if (bumped.count > 0) return;

  // First send of the day (or ever): roll the counter over. The race window
  // here is one statement wide and can only mis-count sends that land in the
  // same instant as a midnight rollover, which is not worth a lock.
  await prisma.emailWarmup.updateMany({
    where: { domain: domain.toLowerCase() },
    data: { sentToday: count, countedOn: today },
  });
}

/**
 * Hand back budget that was reserved but not spent — recipients that turned out
 * to be suppressed, opted out, or otherwise skipped never reached an inbox, so
 * they must not consume a warm-up day.
 */
export async function releaseWarmupSends(
  domain: string | null,
  count: number,
  now: Date = new Date(),
): Promise<void> {
  if (!domain || count <= 0) return;
  const today = utcDayStart(now);
  const row = await prisma.emailWarmup.findUnique({
    where: { domain: domain.toLowerCase() },
    select: { sentToday: true, countedOn: true },
  });
  if (!row || !row.countedOn || utcDayStart(row.countedOn).getTime() !== today.getTime()) {
    return;
  }
  await prisma.emailWarmup.update({
    where: { domain: domain.toLowerCase() },
    data: { sentToday: Math.max(0, row.sentToday - count) },
  });
}

/**
 * Begin (or restart) a warm-up for a domain.
 *
 * Restarting resets the ramp to day 0 on purpose: the reason to restart is that
 * the domain's reputation needs rebuilding, and resuming at day 12 would repeat
 * whatever caused that.
 */
export async function startWarmup(domain: string): Promise<void> {
  const key = domain.toLowerCase();
  const fresh = {
    startedAt: new Date(),
    status: 'active',
    sentToday: 0,
    countedOn: null,
    pausedAt: null,
    pausedReason: null,
    heldOnDay: null,
  };
  await prisma.emailWarmup.upsert({
    where: { domain: key },
    create: { domain: key, ...fresh },
    update: fresh,
  });
}

/** Lift the cap without losing the elapsed-days history. */
export async function pauseWarmup(domain: string, reason: string): Promise<void> {
  await prisma.emailWarmup.updateMany({
    where: { domain: domain.toLowerCase() },
    data: { status: 'paused', pausedAt: new Date(), pausedReason: reason },
  });
}

/** Resume a paused ramp where it left off. */
export async function resumeWarmup(domain: string): Promise<void> {
  await prisma.emailWarmup.updateMany({
    where: { domain: domain.toLowerCase(), status: 'paused' },
    data: { status: 'active', pausedAt: null, pausedReason: null },
  });
}
