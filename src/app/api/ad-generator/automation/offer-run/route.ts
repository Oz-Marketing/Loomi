/**
 * The on-demand OEM offer run — /api/ad-generator/automation/offer-run
 *
 * POST { accountKey, scope?, notifyClients? }
 *   → 202 { runId, cycleKey } and the run continues after the response.
 *
 * WHY 202. The app runs `next start` under PM2 behind nginx: a handler is never
 * cut by `maxDuration`, but nginx returns 504 at its 60s default, and a
 * 25-vehicle fan-out takes minutes. Answering at once with the run id and
 * finishing in the long-lived process means the caller polls instead of
 * waiting on a socket that nginx will close. The run row is opened HERE, before
 * the 202, so a second click meets the per-account lock (409) rather than
 * starting a second run.
 *
 * GET ?runId=… → the run's progress, for the poll.
 *
 * Same gate as the shadow route (`gateOfferRun`), same orchestrator as the
 * scheduled job (`runOfferCampaign`) — one code path, two doors.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { canAccessAccount, getAccountScope, getAuthSession, forbidden } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { GENERATE_CONFIG_SELECT, type GenerateConfigRow } from '@/lib/ad-generator/automation/generate-ads';
import {
  beginRun,
  getRunStatus,
  OfferRunInProgressError,
  runOfferCampaign,
} from '@/lib/ad-generator/automation/offer-run';
import { offerCycleKey } from '@/lib/ad-generator/automation/offer-campaign';
import { runWindowFor } from '@/lib/ad-generator/automation/poll-offers';
import { gateOfferRun, sanitizeScope } from '@/lib/ad-generator/automation/route-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const runId = (req.nextUrl.searchParams.get('runId') || '').trim();
  if (!runId) return NextResponse.json({ error: 'runId is required' }, { status: 400 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const run = await getRunStatus(runId);
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (run.accountKey && !canAccessAccount(getAccountScope(session), run.accountKey)) return forbidden();
  return NextResponse.json({ run });
}

export async function POST(req: NextRequest) {
  let body: {
    accountKey?: string;
    scope?: { vehicles?: unknown[]; offerTypes?: unknown[] };
    notifyClients?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const accountKey = (body.accountKey ?? '').trim();
  const denied = await gateOfferRun(accountKey);
  if (denied) return denied;

  const config = (await prisma.adAutomationConfig.findUnique({
    where: { accountKey },
    select: GENERATE_CONFIG_SELECT,
  })) as GenerateConfigRow | null;
  if (!config) {
    return NextResponse.json({ error: 'not_ready', readiness: 'no_config' }, { status: 400 });
  }
  const offers = await prisma.oemOfferSnapshot.count({ where: { accountKey, endedAt: null } });
  if (offers === 0) {
    // A run with no live offers iterates nothing and reports nothing — not an
    // outcome worth a 202.
    return NextResponse.json({ error: 'not_ready', readiness: 'no_offers' }, { status: 400 });
  }

  const session = await getAuthSession();
  const now = new Date();
  let runId: string;
  try {
    runId = await beginRun(accountKey, now);
  } catch (err) {
    if (err instanceof OfferRunInProgressError) {
      return NextResponse.json(
        { error: 'run_in_progress', since: err.since?.toISOString() ?? null },
        { status: 409 },
      );
    }
    console.error('[api/adgen/offer-run] could not open the run row:', err);
    return NextResponse.json({ error: 'run_not_recorded' }, { status: 503 });
  }

  const scope = sanitizeScope(body.scope);
  const trigger = {
    kind: 'manual' as const,
    userId: session?.user?.id ?? null,
    userName: session?.user?.name ?? null,
  };
  // The response goes out now; the run finishes in this process.
  after(async () => {
    try {
      await runOfferCampaign(config, {
        runId,
        scope,
        trigger,
        notifyClients: body.notifyClients !== false,
        now,
      });
    } catch (err) {
      // Already recorded on the run row by the orchestrator's finally.
      console.error(`[api/adgen/offer-run] ${accountKey} run ${runId} failed:`, err);
    }
  });

  return NextResponse.json(
    { runId, cycleKey: offerCycleKey(accountKey, runWindowFor(config, now)) },
    { status: 202 },
  );
}
