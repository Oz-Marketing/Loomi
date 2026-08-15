/**
 * Email & Text Blasts — GET /api/reporting/blasts
 *
 * One report over every one-off send for an account, from three sources:
 * Loomi email, Loomi text, and the email history carried over from the
 * provider used before Loomi. Replaces the old GoHighLevel-only email report
 * (`/api/reporting/email`), which is kept for now as a raw view of the
 * historical feed alone.
 *
 * ── THE HISTORICAL FEED IS BEST-EFFORT ──────────────────────────────────────
 * The previous provider is a live third-party API that many accounts are no
 * longer configured against. Not being connected is the EXPECTED state for an
 * account that started on Loomi, so it is reported as `historyAvailable: false`
 * with a reason — never as an error that blanks the page. Loomi's own numbers
 * do not depend on it.
 *
 *   ?accountKey=…&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReportingAccess } from '../_lib/guard';
import { canAccessAccount } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  GhlError,
  getGhlCredentials,
  getEmailBlastsNormalized,
  type EmailBlast,
} from '@/lib/integrations/gohighlevel';
import { getEngagementTotals, getCampaignEngagement } from '@/lib/services/email-analytics';
import { getTextTotals, getTextBlasts } from '@/lib/services/sms-analytics';
import {
  emailRates,
  textRates,
  addEmailCounts,
  combine,
  sortBlasts,
  foldSources,
  EMPTY_EMAIL_COUNTS,
  type EmailCounts,
  type BlastRow,
} from '@/lib/reporting/blasts';

export const dynamic = 'force-dynamic';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const safe = (num: number, den: number) => (den > 0 ? num / den : 0);

/** Historical campaigns within the window. Undated ones pass through — see below. */
function inWindow(all: EmailBlast[], start: string | null, end: string | null): EmailBlast[] {
  const startMs = start ? new Date(`${start}T00:00:00Z`).getTime() : null;
  const endMs = end ? new Date(`${end}T23:59:59Z`).getTime() : null;
  return all.filter((c) => {
    // An undated campaign can't be excluded on a date it doesn't have. Dropping
    // it would silently shrink the history this exists to preserve, so it
    // passes through and is visible as an undated row in the table.
    if (!c.scheduled_at) return true;
    const t = new Date(`${c.scheduled_at}Z`).getTime();
    if (!Number.isFinite(t)) return true;
    if (startMs != null && t < startMs) return false;
    if (endMs != null && t > endMs) return false;
    return true;
  });
}

function historicalCounts(campaigns: EmailBlast[]): EmailCounts {
  const sum = (k: keyof EmailBlast) => campaigns.reduce((t, c) => t + (Number(c[k]) || 0), 0);
  const opened = sum('opened');
  const clicked = sum('clicked');
  return {
    campaigns: campaigns.length,
    sent: sum('sent'),
    delivered: sum('delivered'),
    // The previous provider reports ONE open figure per campaign with no
    // unique/repeat split. It is recorded in both slots rather than guessed
    // apart; the UI flags that the unique/total distinction is Loomi-only.
    uniqueOpens: opened,
    totalOpens: opened,
    uniqueClicks: clicked,
    totalClicks: clicked,
    bounces: sum('bounced'),
    failed: sum('failed') + sum('errors'),
    unsubscribes: sum('unsubscribed'),
  };
}

export async function GET(req: NextRequest) {
  const { ctx, error } = await requireReportingAccess();
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const accountKey = sp.get('accountKey');
  if (!accountKey) return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  if (!canAccessAccount(ctx.accountKeys, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const startDate = sp.get('start_date');
  const endDate = sp.get('end_date');
  if ((startDate && !ISO_DATE.test(startDate)) || (endDate && !ISO_DATE.test(endDate))) {
    return NextResponse.json({ error: 'start_date / end_date must be YYYY-MM-DD' }, { status: 400 });
  }

  const start = startDate ? new Date(`${startDate}T00:00:00Z`) : null;
  const end = endDate ? new Date(`${endDate}T23:59:59Z`) : null;
  const scope = { accountKeys: [accountKey], start, end };

  try {
    const account = await prisma.account.findUnique({
      where: { key: accountKey },
      select: { dealer: true },
    });
    if (!account) return NextResponse.json({ error: 'Unknown account' }, { status: 404 });

    // The historical feed is a third-party call; it must not be able to fail
    // the whole report, so it resolves to a status either way.
    const historyPromise: Promise<
      { ok: true; campaigns: EmailBlast[] } | { ok: false; reason: string }
    > = (async () => {
      try {
        const creds = await getGhlCredentials(accountKey);
        return { ok: true as const, campaigns: await getEmailBlastsNormalized(creds) };
      } catch (err) {
        if (err instanceof GhlError) {
          return {
            ok: false as const,
            reason:
              err.code === 'not_configured'
                ? 'This account has no history with a previous provider.'
                : 'The previous provider could not be reached, so historical sends are missing from these totals.',
          };
        }
        throw err;
      }
    })();

    const [loomiEmail, loomiEmailRows, textCounts, textRows, history] = await Promise.all([
      getEngagementTotals(scope),
      getCampaignEngagement(scope),
      getTextTotals(scope),
      getTextBlasts(scope),
      historyPromise,
    ]);

    const loomiEmailCounts: EmailCounts = {
      campaigns: loomiEmailRows.length,
      sent: loomiEmail.totals.sent,
      delivered: loomiEmail.totals.delivered,
      uniqueOpens: loomiEmail.totals.uniqueOpens,
      totalOpens: loomiEmail.totals.totalOpens,
      uniqueClicks: loomiEmail.totals.uniqueClicks,
      totalClicks: loomiEmail.totals.totalClicks,
      bounces: loomiEmail.totals.bounces,
      failed: loomiEmail.totals.failed,
      unsubscribes: loomiEmail.totals.unsubscribes,
    };

    const historyCampaigns = history.ok ? inWindow(history.campaigns, startDate, endDate) : [];
    const historyCounts = history.ok ? historicalCounts(historyCampaigns) : EMPTY_EMAIL_COUNTS;

    const rows: BlastRow[] = [
      ...loomiEmailRows.map((c) => ({
        id: `loomi-email:${c.campaignId}`,
        name: c.campaignName ?? 'Untitled',
        channel: 'email' as const,
        source: 'loomi' as const,
        sentAt: c.sentAt ? c.sentAt.toISOString().slice(0, 10) : null,
        sent: c.sent,
        delivered: c.delivered,
        opens: c.uniqueOpens,
        clicks: c.uniqueClicks,
        failed: c.failed,
        deliveryRate: c.deliveryRate,
        openRate: c.openRate,
        clickRate: c.clickRate,
      })),
      ...textRows.map((t) => ({
        id: `loomi-text:${t.campaignId}`,
        name: t.campaignName ?? 'Untitled',
        channel: 'text' as const,
        source: 'loomi' as const,
        sentAt: t.sentAt ? t.sentAt.toISOString().slice(0, 10) : null,
        sent: t.sent,
        delivered: t.delivered,
        // Null, not zero — a text has no opens to have none of.
        opens: null,
        clicks: null,
        failed: t.failed,
        deliveryRate: safe(t.delivered, t.sent),
        openRate: null,
        clickRate: null,
      })),
      ...historyCampaigns.map((c) => ({
        id: `other-email:${c.id}`,
        name: c.name,
        channel: 'email' as const,
        source: 'other' as const,
        sentAt: c.scheduled_at ? c.scheduled_at.slice(0, 10) : null,
        sent: c.sent,
        delivered: c.delivered,
        opens: c.opened,
        clicks: c.clicked,
        failed: c.failed + c.errors,
        deliveryRate: safe(c.delivered, c.sent),
        openRate: safe(c.opened, c.delivered),
        clickRate: safe(c.clicked, c.delivered),
      })),
    ];

    // Sum the two email sources ONCE, then derive rates from the sum and hand
    // the same summed counts to `combine`. Spreading one source over the other
    // would overwrite rather than add, and passing rates into `combine` would
    // defeat the reason it takes counts.
    const mergedEmailCounts = addEmailCounts(loomiEmailCounts, historyCounts);
    const emailTotals = emailRates(mergedEmailCounts);
    const combinedCounts = combine(mergedEmailCounts, textCounts);

    return NextResponse.json({
      dealer: account.dealer,
      accountKey,
      // Flat totals under `summary` so the shared fan-out in
      // _components/account-sources.ts can read this route with no special
      // case — it looks for accountMetrics / overview / summary. The old
      // email route nested its figures under `stats`, which that fan-out never
      // looked at, so the Marketing Overview and the Ad Meeting builder have
      // been rendering Email as "no data" regardless of what was there.
      summary: {
        sends: combinedCounts.campaigns,
        sent: combinedCounts.sent,
        delivered: combinedCounts.delivered,
        deliveryRate: combinedCounts.deliveryRate,
        opens: emailTotals.uniqueOpens,
        clicks: emailTotals.uniqueClicks,
        openRate: emailTotals.openRate,
        clickRate: emailTotals.clickRate,
        textSent: textCounts.sent,
      },
      combined: combinedCounts,
      email: emailTotals,
      text: textRates(textCounts),
      byChannel: {
        loomiEmail: emailRates(loomiEmailCounts),
        historicalEmail: emailRates(historyCounts),
      },
      sources: foldSources(rows),
      blasts: sortBlasts(rows),
      // Loomi-only: the historical feed has no per-event rows to place on a
      // calendar. See lib/reporting/blasts.ts.
      series: loomiEmail.series,
      topUrls: loomiEmail.topUrls,
      historyAvailable: history.ok,
      historyNote: history.ok ? null : history.reason,
      seriesIsLoomiOnly: historyCounts.sent > 0,
    });
  } catch (err) {
    console.error('[reporting/blasts]', err);
    return NextResponse.json({ error: 'Failed to load blasts' }, { status: 500 });
  }
}
