/**
 * Email & Text Blasts — one report over every one-off send, whatever sent it.
 *
 * Three sources feed this:
 *   • Loomi email blasts   — per-event rows (EmailEvent), full engagement
 *   • Loomi text blasts    — per-event rows (SmsEvent), delivery only
 *   • Historical email     — campaign-level aggregates from the previous
 *                            provider, kept so the history doesn't start over
 *
 * ── CHANNELS DO NOT SUM ─────────────────────────────────────────────────────
 * The temptation is one KPI row across everything. It produces a lie: SMS has
 * no open tracking — not "zero opens", NO SUCH EVENT — so an open rate over
 * (email + text) sends is really email opens divided by a denominator that
 * grows every time someone sends a text. The rate would sink as texting
 * increased, and read as engagement getting worse.
 *
 * So the channels stay apart, and only the three measures that mean the same
 * thing in both — sent, delivered, failed — roll into a combined header. Every
 * engagement measure (opens, clicks, unsubscribes) lives on the email side
 * alone. `combine` below will not accept anything else.
 *
 * ── RATES ARE RECOMPUTED, NEVER AVERAGED ────────────────────────────────────
 * Merging two sources sums the raw counts and derives the rates again from the
 * sums. Averaging two rates weights a 50-recipient send the same as a 50,000-
 * recipient one. Same rule as direct-mail.ts's rollUp.
 */

/** Where a send came from. The UI never names the previous vendor. */
export type BlastSource = 'loomi' | 'other';

export const SOURCE_LABEL: Record<BlastSource, string> = {
  loomi: 'Loomi',
  other: 'Another provider',
};

/** Raw email counts, before any rate is derived. */
export interface EmailCounts {
  campaigns: number;
  sent: number;
  delivered: number;
  uniqueOpens: number;
  totalOpens: number;
  uniqueClicks: number;
  totalClicks: number;
  bounces: number;
  failed: number;
  unsubscribes: number;
}

export interface EmailRates {
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  bounceRate: number;
  unsubscribeRate: number;
}

export type EmailTotals = EmailCounts & EmailRates;

/** Raw text counts. No opens, no clicks — the channel has neither. */
export interface TextCounts {
  campaigns: number;
  sent: number;
  delivered: number;
  failed: number;
  optOuts: number;
}

export interface TextRates {
  deliveryRate: number;
  failureRate: number;
  optOutRate: number;
}

export type TextTotals = TextCounts & TextRates;

/**
 * The only figures that mean the same thing in both channels. Deliberately
 * small — if you find yourself wanting to add `opens` here, re-read the header.
 */
export interface CombinedTotals {
  campaigns: number;
  sent: number;
  delivered: number;
  failed: number;
  deliveryRate: number;
}

const safe = (num: number, den: number): number => (den > 0 ? num / den : 0);

export const EMPTY_EMAIL_COUNTS: EmailCounts = {
  campaigns: 0,
  sent: 0,
  delivered: 0,
  uniqueOpens: 0,
  totalOpens: 0,
  uniqueClicks: 0,
  totalClicks: 0,
  bounces: 0,
  failed: 0,
  unsubscribes: 0,
};

export const EMPTY_TEXT_COUNTS: TextCounts = {
  campaigns: 0,
  sent: 0,
  delivered: 0,
  failed: 0,
  optOuts: 0,
};

/**
 * Derive email rates from counts.
 *
 * Denominators follow the existing email-analytics service so the two surfaces
 * agree: opens and clicks are measured against DELIVERED (you cannot open what
 * never arrived), bounces against SENT.
 */
export function emailRates(c: EmailCounts): EmailTotals {
  return {
    ...c,
    deliveryRate: safe(c.delivered, c.sent),
    openRate: safe(c.uniqueOpens, c.delivered),
    clickRate: safe(c.uniqueClicks, c.delivered),
    clickToOpenRate: safe(c.uniqueClicks, c.uniqueOpens),
    bounceRate: safe(c.bounces, c.sent),
    unsubscribeRate: safe(c.unsubscribes, c.delivered),
  };
}

export function textRates(c: TextCounts): TextTotals {
  return {
    ...c,
    deliveryRate: safe(c.delivered, c.sent),
    failureRate: safe(c.failed, c.sent),
    optOutRate: safe(c.optOuts, c.delivered),
  };
}

export function addEmailCounts(a: EmailCounts, b: EmailCounts): EmailCounts {
  return {
    campaigns: a.campaigns + b.campaigns,
    sent: a.sent + b.sent,
    delivered: a.delivered + b.delivered,
    uniqueOpens: a.uniqueOpens + b.uniqueOpens,
    totalOpens: a.totalOpens + b.totalOpens,
    uniqueClicks: a.uniqueClicks + b.uniqueClicks,
    totalClicks: a.totalClicks + b.totalClicks,
    bounces: a.bounces + b.bounces,
    failed: a.failed + b.failed,
    unsubscribes: a.unsubscribes + b.unsubscribes,
  };
}

/** Sum many sources' counts, then derive the rates once from the sum. */
export function mergeEmail(parts: EmailCounts[]): EmailTotals {
  return emailRates(parts.reduce(addEmailCounts, EMPTY_EMAIL_COUNTS));
}

/**
 * Roll the two channels into the header figures.
 *
 * Takes COUNTS, not totals, precisely so no rate can be averaged in by
 * accident — the one rate it returns is derived here from the summed parts.
 */
export function combine(email: EmailCounts, text: TextCounts): CombinedTotals {
  const sent = email.sent + text.sent;
  const delivered = email.delivered + text.delivered;
  return {
    campaigns: email.campaigns + text.campaigns,
    sent,
    delivered,
    failed: email.failed + text.failed,
    deliveryRate: safe(delivered, sent),
  };
}

/**
 * A single send, in the flat shape the table renders.
 *
 * `sentAt` is nullable because the previous provider let a campaign exist
 * without a schedule date, and dropping those would quietly shrink the history
 * this whole exercise exists to preserve.
 */
export interface BlastRow {
  id: string;
  name: string;
  channel: 'email' | 'text';
  source: BlastSource;
  sentAt: string | null;
  sent: number;
  delivered: number;
  /** Null on text — the channel has no such measure. Not zero. */
  opens: number | null;
  clicks: number | null;
  failed: number;
  deliveryRate: number;
  /** Null on text, for the same reason as `opens`. */
  openRate: number | null;
  clickRate: number | null;
}

/**
 * Sort newest first, with undated sends last.
 *
 * Undated rows sort to the bottom rather than to 1970: they are almost all
 * historical imports, and floating them to the top of a report about recent
 * activity would bury the sends someone actually came to look at.
 */
export function sortBlasts(rows: BlastRow[]): BlastRow[] {
  return [...rows].sort((a, b) => {
    if (a.sentAt === b.sentAt) return a.name.localeCompare(b.name);
    if (a.sentAt === null) return 1;
    if (b.sentAt === null) return -1;
    return b.sentAt.localeCompare(a.sentAt);
  });
}

/** Per-source counts, for the "where did this come from" breakdown. */
export interface SourceBreakdown {
  source: BlastSource;
  label: string;
  campaigns: number;
  sent: number;
  share: number;
}

export function foldSources(rows: BlastRow[]): SourceBreakdown[] {
  const by = new Map<BlastSource, { campaigns: number; sent: number }>();
  for (const r of rows) {
    const cur = by.get(r.source) ?? { campaigns: 0, sent: 0 };
    cur.campaigns += 1;
    cur.sent += r.sent;
    by.set(r.source, cur);
  }
  const totalSent = rows.reduce((n, r) => n + r.sent, 0);
  return [...by.entries()]
    .map(([source, v]) => ({
      source,
      label: SOURCE_LABEL[source],
      campaigns: v.campaigns,
      sent: v.sent,
      share: safe(v.sent, totalSent),
    }))
    .sort((a, b) => b.sent - a.sent);
}

/**
 * Day buckets for the trend chart.
 *
 * ONLY Loomi sends can appear here. The previous provider hands over
 * campaign-level aggregates with no per-event rows, so there is no honest way
 * to place its opens on a calendar — spreading a campaign's total across its
 * send window would draw a shape that never happened. The UI says so rather
 * than quietly plotting a partial series as if it were the whole picture.
 */
export interface DayPoint {
  date: string;
  delivered: number;
  opens: number;
  clicks: number;
}

export function mergeSeries(parts: DayPoint[][]): DayPoint[] {
  const by = new Map<string, DayPoint>();
  for (const part of parts) {
    for (const p of part) {
      const cur = by.get(p.date) ?? { date: p.date, delivered: 0, opens: 0, clicks: 0 };
      cur.delivered += p.delivered;
      cur.opens += p.opens;
      cur.clicks += p.clicks;
      by.set(p.date, cur);
    }
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}
