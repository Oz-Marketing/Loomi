// GET/POST /api/audiences/[id]/syncs
//
// A sync binds (segment × sub-account × provider). Listing returns each
// binding with its most recent runs, which is what a "is this actually
// working?" view needs: last run, what changed, and why anything was
// excluded.

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { KNOWN_PROVIDERS } from '@/lib/segments/sync/destination';

type RouteContext = { params: Promise<{ id: string }> };

const CHANNELS = new Set(['email', 'phone', 'any']);
const SCHEDULES = new Set(['manual', 'daily']);
const STATUSES = new Set(['active', 'paused']);

export async function GET(_req: Request, { params }: RouteContext) {
  const { session, error } = await requireRole(
    'developer',
    'super_admin',
    'admin',
  );
  if (error) return error;

  const { id } = await params;
  const allowed = allowedKeys(session!.user);

  const syncs = await prisma.audienceSync.findMany({
    where: {
      audienceId: id,
      ...(allowed ? { accountKey: { in: allowed } } : {}),
    },
    include: {
      runs: {
        orderBy: { startedAt: 'desc' },
        take: 10,
      },
      _count: { select: { members: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({
    syncs: syncs.map((sync) => ({
      id: sync.id,
      accountKey: sync.accountKey,
      provider: sync.provider,
      status: sync.status,
      schedule: sync.schedule,
      channel: sync.channel,
      externalId: sync.externalId,
      memberCount: sync._count.members,
      lastRunAt: sync.lastRunAt,
      lastSuccessAt: sync.lastSuccessAt,
      lastError: sync.lastError,
      runs: sync.runs,
    })),
  });
}

export async function POST(req: Request, { params }: RouteContext) {
  const { session, error } = await requireRole(
    'developer',
    'super_admin',
    'admin',
  );
  if (error) return error;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }

  const audience = await prisma.audience.findUnique({
    where: { id },
    select: { id: true, accountKey: true },
  });
  if (!audience) {
    return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
  }

  const accountKey =
    typeof body.accountKey === 'string' ? body.accountKey.trim() : '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }
  const allowed = allowedKeys(session!.user);
  if (allowed && !allowed.includes(accountKey)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // An account-scoped segment can only be synced for its own account;
  // an org-wide one can be synced for any account it's visible in.
  if (audience.accountKey && audience.accountKey !== accountKey) {
    return NextResponse.json(
      { error: 'This segment belongs to a different account' },
      { status: 400 },
    );
  }

  const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
  if (!(KNOWN_PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${KNOWN_PROVIDERS.join(', ')}` },
      { status: 400 },
    );
  }

  const channel = typeof body.channel === 'string' ? body.channel : 'any';
  if (!CHANNELS.has(channel)) {
    return NextResponse.json({ error: 'channel must be email, phone or any' }, { status: 400 });
  }
  const schedule = typeof body.schedule === 'string' ? body.schedule : 'manual';
  if (!SCHEDULES.has(schedule)) {
    return NextResponse.json({ error: 'schedule must be manual or daily' }, { status: 400 });
  }
  // New syncs are PAUSED unless explicitly activated. Creating a binding
  // shouldn't start shipping contacts anywhere as a side effect.
  const status = typeof body.status === 'string' ? body.status : 'paused';
  if (!STATUSES.has(status)) {
    return NextResponse.json({ error: 'status must be active or paused' }, { status: 400 });
  }

  const sync = await prisma.audienceSync.upsert({
    where: {
      audienceId_accountKey_provider: { audienceId: id, accountKey, provider },
    },
    create: {
      audienceId: id,
      accountKey,
      provider,
      channel,
      schedule,
      status,
      createdByUserId: session!.user.id,
      config: typeof body.config === 'object' && body.config ? JSON.stringify(body.config) : null,
    },
    update: { channel, schedule, status },
  });

  return NextResponse.json({ sync }, { status: 201 });
}

/** Null means unrestricted (developer / super_admin). */
function allowedKeys(user: {
  role: string;
  accountKeys?: string[] | null;
}): string[] | null {
  if (user.role === 'developer' || user.role === 'super_admin') return null;
  return user.accountKeys ?? [];
}
