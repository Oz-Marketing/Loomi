/**
 * Sending-domain warm-up, per account.
 *
 * The warm-up itself is keyed on the DOMAIN, not the account (rooftops sharing
 * a From domain share one reputation and therefore one daily budget). This
 * route is account-scoped only because that's how the caller reaches it — the
 * domain is derived from the account's `senderEmail`, and the response says so
 * explicitly with `sharedWith`, so staff can see when starting a warm-up will
 * throttle sibling accounts too.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import {
  WARMUP_SCHEDULE,
  getAllowances,
  pauseWarmup,
  resumeWarmup,
  sendingDomain,
  startWarmup,
} from '@/lib/sending/warmup';

interface RouteParams {
  params: Promise<{ key: string }>;
}

/** Accounts other than this one that send from the same domain. */
async function siblingAccounts(domain: string, exceptKey: string): Promise<string[]> {
  const rows = await prisma.account.findMany({
    where: {
      key: { not: exceptKey },
      // A JSON-free scalar column, so a plain suffix match is exact enough:
      // an address ending in "@<domain>" is on that domain.
      senderEmail: { endsWith: `@${domain}`, mode: 'insensitive' },
    },
    select: { dealer: true, key: true },
  });
  return rows.map((r) => r.dealer || r.key);
}

/**
 * GET /api/accounts/[key]/warmup
 *
 * Current ramp state for the account's sending domain, plus the schedule
 * itself so the UI can show staff what the coming days look like rather than
 * only today's number.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requirePermission('agency.subaccounts.view');
  if (error) return error;

  const { key } = await params;
  if (session!.user.role === 'admin' && !session!.user.accountKeys.includes(key)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const account = await prisma.account.findUnique({
    where: { key },
    select: { senderEmail: true },
  });
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const domain = sendingDomain(account.senderEmail);
  if (!domain) {
    // No From address yet, so there is no domain to warm. Not an error — it's
    // the ordinary state of a half-configured account, and the UI says so.
    return NextResponse.json({
      domain: null,
      allowance: null,
      schedule: WARMUP_SCHEDULE,
      sharedWith: [],
    });
  }

  const allowance = (await getAllowances([domain])).get(domain) ?? null;
  return NextResponse.json({
    domain,
    allowance,
    schedule: WARMUP_SCHEDULE,
    sharedWith: await siblingAccounts(domain, key),
  });
}

/**
 * POST /api/accounts/[key]/warmup
 *
 * Body: { action: 'start' | 'pause' | 'resume', reason?: string }
 *
 * Starting is destructive to an existing ramp (it resets to day 0), which is
 * deliberate — see startWarmup — so it needs the edit permission, not view.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requirePermission('agency.subaccounts.edit');
  if (error) return error;

  const { key } = await params;
  if (session!.user.role === 'admin' && !session!.user.accountKeys.includes(key)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const account = await prisma.account.findUnique({
    where: { key },
    select: { senderEmail: true },
  });
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const domain = sendingDomain(account.senderEmail);
  if (!domain) {
    return NextResponse.json(
      { error: 'Set a From address for this account before starting a warm-up.' },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === 'start') {
    await startWarmup(domain);
  } else if (action === 'pause') {
    const reason =
      typeof body?.reason === 'string' && body.reason.trim()
        ? body.reason.trim()
        : 'Paused manually';
    await pauseWarmup(domain, reason);
  } else if (action === 'resume') {
    await resumeWarmup(domain);
  } else {
    return NextResponse.json(
      { error: "action must be 'start', 'pause' or 'resume'" },
      { status: 400 },
    );
  }

  const allowance = (await getAllowances([domain])).get(domain) ?? null;
  return NextResponse.json({
    domain,
    allowance,
    schedule: WARMUP_SCHEDULE,
    sharedWith: await siblingAccounts(domain, key),
  });
}
