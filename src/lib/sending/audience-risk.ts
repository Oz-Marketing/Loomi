// Audience quality gate for email blasts.
//
// WHY THIS EXISTS
// ───────────────
// A 4,781-recipient blast went out from a domain seven days into its
// warm-up ramp and hard-bounced 685 addresses — 25.7% of everything it
// attempted. Nothing in the product noticed, before or during.
//
// Suppression already handles the SECOND offense: a bounce webhook writes
// EmailSuppression and the next blast skips that address (org-wide, see
// persistSuppression). What nothing covered is the FIRST send to a list
// nobody has ever mailed — which is exactly the shape that did the damage,
// and the shape that hurts most, because a domain still building reputation
// is judged on precisely these numbers.
//
// So this looks at two different things:
//
//   1. What history says. Addresses we HAVE mailed carry a measured
//      hard-bounce rate. A high one is unambiguous and worth blocking.
//   2. What history can't say. An audience nobody has mailed has no rate at
//      all, and a large unproven list on a warming domain is a gamble. That
//      can only ever be a warning — every list is unproven once, and you
//      cannot earn a reputation without sending.
//
// Thresholds are deliberately conservative. The failure mode of blocking a
// legitimate campaign is worse than the failure mode of a warning someone
// reads, so only (1) can block, and only well past the point of doubt.

import { prisma } from '@/lib/prisma';
import { getAllowances } from '@/lib/sending/warmup';
// Type-only: erased at build, so this does not create an import cycle with
// blast-preflight, which imports this module's functions.
import type { PreflightIssue } from './blast-preflight';

/** Stable codes so the UI can explain and deep-link each finding. */
export const AUDIENCE_RISK_CODES = {
  BOUNCE_RATE: 'audience_bounce_rate',
  UNPROVEN_ON_WARMUP: 'audience_unproven_on_warmup',
  MOSTLY_SUPPRESSED: 'audience_mostly_suppressed',
} as const;

// ── Thresholds ──
//
// Mailbox providers start treating a sender as a spammer somewhere around a
// 2% hard-bounce rate; 5% is already trouble on an established domain.

/** Measured hard-bounce rate that earns a warning on a settled domain. */
export const BOUNCE_RATE_WARN = 0.05;
/** The same, while the sending domain is still warming. */
export const BOUNCE_RATE_WARN_WARMUP = 0.02;
/** Past this, the list is rotten enough to refuse. */
export const BOUNCE_RATE_BLOCK = 0.15;
/** Below this much history a "rate" is noise, not a signal. */
export const MIN_HISTORY_FOR_RATE = 50;
/** Unproven-audience warning only fires for a send big enough to matter. */
export const UNPROVEN_MIN_AUDIENCE = 500;
/** ...and only when this much of it has never been mailed. */
export const UNPROVEN_SHARE_WARN = 0.8;
/** A list this far gone is worth saying out loud. */
export const SUPPRESSED_SHARE_WARN = 0.25;

/**
 * Is this stored recipient error a PERMANENT delivery failure?
 *
 * Only SendGrid bounce/dropped events say anything about an address. A
 * send-time infrastructure failure — a database error, a timeout — means the
 * message never left, which is not the address's fault and must never count
 * against the list. (Production carries 254 such rows from a connection-pool
 * exhaustion, and counting those as bounces would be badly misleading.)
 *
 * Soft patterns are checked FIRST and win ties on purpose: "552 5.2.2 inbox
 * out of storage" carries a 5.x.x code but is a full mailbox, not a dead
 * address. Undercounting is the safe direction for a check that can block a
 * send.
 */
export function isHardBounceError(error: string | null | undefined): boolean {
  if (!error) return false;
  const text = error.trim();
  if (!/^(bounce|dropped)\b/i.test(text)) return false;
  if (SOFT_BOUNCE_PATTERNS.some((re) => re.test(text))) return false;
  return HARD_BOUNCE_PATTERNS.some((re) => re.test(text));
}

const SOFT_BOUNCE_PATTERNS: RegExp[] = [
  /\b4\.\d{1,3}\.\d{1,3}\b/,
  /out of storage/i,
  /over quota|quota exceeded/i,
  /try again|temporar|deferred|greylist|throttl|rate limit|too many/i,
  /timed? ?out/i,
];

const HARD_BOUNCE_PATTERNS: RegExp[] = [
  /\b5\.\d{1,3}\.\d{1,3}\b/,
  /does not exist|no such (user|address|mailbox)/i,
  /(user|recipient|address|mailbox) (is )?(unknown|invalid|not found)/i,
  /unknown (user|recipient)/i,
  /not our customer/i,
  /unrecognized address|unable to get mx|domain not found|no mx record/i,
  /relaying denied/i,
  // maybeUpdateRecipientStatus stores a reasonless hard bounce as exactly
  // "bounce (hard)" — no SMTP code to match on.
  /\(hard\)/i,
];

/** What we could learn about an audience before sending to it. */
export interface AudienceRisk {
  /** Everyone the blast would target. */
  total: number;
  /** Already suppressed — these get skipped, so they are not a risk. */
  suppressed: number;
  /** total − suppressed: what would actually be attempted. */
  sendable: number;
  /** Sendable addresses this account has mailed before. */
  withHistory: number;
  /** Sendable addresses with no send history at all. */
  neverMailed: number;
  /** Of `withHistory`, how many have ever hard-bounced. */
  priorHardBounces: number;
  /** null when there is too little history to mean anything. */
  historicalBounceRate: number | null;
  /** neverMailed / sendable, 0 when there is nothing to send. */
  unprovenShare: number;
  /** 1-based ramp position, or null when the domain is not warming. */
  warmupDay: number | null;
  warmupTotalDays: number;
}

/**
 * Measure an audience against this account's own send history.
 *
 * Two indexed aggregate reads over EmailCampaignRecipient plus one
 * suppression count — it does not walk the audience row by row, so it stays
 * cheap enough to run inside the schedule gate.
 */
export async function assessAudienceRisk(
  accountKey: string,
  emails: string[],
): Promise<AudienceRisk> {
  const unique = [...new Set(emails.map((e) => e.toLowerCase().trim()).filter(Boolean))];

  const warmupDomain = await resolveWarmupDomain(accountKey);
  const allowance = warmupDomain
    ? (await getAllowances([warmupDomain])).get(warmupDomain)
    : undefined;
  const warmupDay = allowance && allowance.status === 'active' ? allowance.day : null;
  const warmupTotalDays = allowance?.totalDays ?? 0;

  const empty: AudienceRisk = {
    total: unique.length,
    suppressed: 0,
    sendable: unique.length,
    withHistory: 0,
    neverMailed: unique.length,
    priorHardBounces: 0,
    historicalBounceRate: null,
    unprovenShare: unique.length > 0 ? 1 : 0,
    warmupDay,
    warmupTotalDays,
  };
  if (unique.length === 0) return { ...empty, unprovenShare: 0 };

  const suppressedRows = await prisma.emailSuppression.findMany({
    where: { accountKey, email: { in: unique } },
    select: { email: true },
  });
  const suppressedSet = new Set(suppressedRows.map((r) => r.email.toLowerCase().trim()));
  const sendableEmails = unique.filter((e) => !suppressedSet.has(e));

  // History for the addresses that would actually be attempted.
  const history = await prisma.emailBlastRecipient.findMany({
    where: { accountKey, email: { in: sendableEmails } },
    select: { email: true, status: true, error: true },
  });

  const seen = new Set<string>();
  const bounced = new Set<string>();
  for (const row of history) {
    const email = (row.email || '').toLowerCase().trim();
    if (!email) continue;
    seen.add(email);
    if (row.status === 'failed' && isHardBounceError(row.error)) bounced.add(email);
  }

  const withHistory = seen.size;
  const priorHardBounces = bounced.size;
  const sendable = sendableEmails.length;

  return {
    total: unique.length,
    suppressed: suppressedSet.size,
    sendable,
    withHistory,
    neverMailed: sendable - withHistory,
    priorHardBounces,
    historicalBounceRate:
      withHistory >= MIN_HISTORY_FOR_RATE ? priorHardBounces / withHistory : null,
    unprovenShare: sendable > 0 ? (sendable - withHistory) / sendable : 0,
    warmupDay,
    warmupTotalDays,
  };
}

/** The domain an account builds reputation on, or null if it has no sender. */
async function resolveWarmupDomain(accountKey: string): Promise<string | null> {
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { senderEmail: true },
  });
  const from = account?.senderEmail;
  if (!from) return null;
  const at = from.lastIndexOf('@');
  if (at < 0 || at === from.length - 1) return null;
  return from.slice(at + 1).trim().toLowerCase() || null;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNum(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Turn a measurement into preflight findings. Pure — all the threshold
 * judgment lives here so it can be tested without a database.
 */
export function audienceRiskIssues(
  risk: AudienceRisk,
  accountKey: string,
): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const warming = risk.warmupDay !== null;

  // ── 1. Measured hard-bounce rate ──
  if (risk.historicalBounceRate !== null) {
    const rate = risk.historicalBounceRate;
    const warnAt = warming ? BOUNCE_RATE_WARN_WARMUP : BOUNCE_RATE_WARN;
    const detail =
      `${formatNum(risk.priorHardBounces)} of the ${formatNum(risk.withHistory)} ` +
      `addresses here that you have mailed before have permanently bounced ` +
      `(${formatPct(rate)}).`;

    if (rate >= BOUNCE_RATE_BLOCK) {
      issues.push({
        severity: 'blocker',
        code: AUDIENCE_RISK_CODES.BOUNCE_RATE,
        accountKey,
        message: `${detail} That is high enough to get the sending domain blocklisted.`,
        remedy:
          'Clean this audience before sending — remove contacts that have bounced, ' +
          'or narrow the segment to people who have opened something recently.',
      });
    } else if (rate >= warnAt) {
      issues.push({
        severity: 'warning',
        code: AUDIENCE_RISK_CODES.BOUNCE_RATE,
        accountKey,
        message:
          `${detail}${warming ? ' The sending domain is still warming up, where bounces cost more.' : ''}`,
        remedy:
          'Consider narrowing the segment to recently engaged contacts before sending.',
      });
    }
  }

  // ── 2. An unproven audience on a warming domain ──
  //
  // Never a blocker: every list is unproven once, and a domain cannot warm
  // up without being sent from.
  if (
    warming &&
    risk.sendable >= UNPROVEN_MIN_AUDIENCE &&
    risk.unprovenShare >= UNPROVEN_SHARE_WARN
  ) {
    issues.push({
      severity: 'warning',
      code: AUDIENCE_RISK_CODES.UNPROVEN_ON_WARMUP,
      accountKey,
      message:
        `${formatNum(risk.neverMailed)} of these ${formatNum(risk.sendable)} addresses ` +
        `have never been mailed from this account, and the sending domain is only on ` +
        `day ${risk.warmupDay} of ${risk.warmupTotalDays} of its warm-up. ` +
        'Bounces from an untested list are what damage a new domain most.',
      remedy:
        'Send to a smaller, recently engaged slice first and check the bounce rate ' +
        'before releasing the rest.',
    });
  }

  // ── 3. A list that is mostly dead weight ──
  if (risk.total > 0 && risk.suppressed / risk.total >= SUPPRESSED_SHARE_WARN) {
    issues.push({
      severity: 'warning',
      code: AUDIENCE_RISK_CODES.MOSTLY_SUPPRESSED,
      accountKey,
      message:
        `${formatNum(risk.suppressed)} of ${formatNum(risk.total)} contacts in this ` +
        'audience are suppressed and will be skipped.',
      remedy:
        'They are safely excluded, but the underlying list is going stale — worth ' +
        'a clean-up so your audience counts mean something.',
    });
  }

  return issues;
}
