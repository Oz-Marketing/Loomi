import { NextRequest, NextResponse } from 'next/server';
import {
  canAccessAccount,
  forbidden,
  getAccountScope,
  requireRole,
} from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  normalizeLeadEmails,
  parseLeadEmails,
  stringifyLeadEmails,
} from '@/lib/integrations/crm/lead-emails';

interface RouteParams {
  params: Promise<{ key: string }>;
}

const MANAGEMENT_ROLES = ['developer', 'super_admin', 'admin'] as const;
const PROVIDERS = ['tekion', 'vinsolutions'] as const;
const RECENT_DELIVERIES = 5;

function serializeDestination(d: {
  id: string;
  provider: string;
  leadEmails: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  deliveries?: {
    id: string;
    status: string;
    attempts: number;
    messageId: string | null;
    lastError: string | null;
    createdAt: Date;
    sentAt: Date | null;
  }[];
}) {
  return {
    id: d.id,
    provider: d.provider,
    leadEmails: parseLeadEmails(d.leadEmails),
    enabled: d.enabled,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    recentDeliveries: (d.deliveries ?? []).map((x) => ({
      id: x.id,
      status: x.status,
      attempts: x.attempts,
      messageId: x.messageId,
      lastError: x.lastError,
      createdAt: x.createdAt,
      sentAt: x.sentAt,
    })),
  };
}

/**
 * GET /api/accounts/[key]/crm
 * Lists the account's CRM destinations + their most recent deliveries.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { key } = await params;
  if (!canAccessAccount(getAccountScope(session!), key)) return forbidden();

  const destinations = await prisma.crmDestination.findMany({
    where: { accountKey: key },
    orderBy: { createdAt: 'desc' },
    include: {
      deliveries: { orderBy: { createdAt: 'desc' }, take: RECENT_DELIVERIES },
    },
  });

  return NextResponse.json({ destinations: destinations.map(serializeDestination) });
}

/**
 * POST /api/accounts/[key]/crm
 * Body: { provider: 'tekion'|'vinsolutions', leadEmails: string[], enabled?: boolean }
 * (also accepts a legacy `leadEmail: string`)
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { key } = await params;
  if (!canAccessAccount(getAccountScope(session!), key)) return forbidden();

  const account = await prisma.account.findUnique({ where: { key }, select: { key: true } });
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  const provider = typeof body.provider === 'string' ? body.provider : '';
  if (!PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) {
    return NextResponse.json(
      { error: `provider must be one of: ${PROVIDERS.join(', ')}` },
      { status: 400 },
    );
  }

  const { emails, invalid } = normalizeLeadEmails(body.leadEmails ?? body.leadEmail);
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Invalid email${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}` },
      { status: 400 },
    );
  }
  if (emails.length === 0) {
    return NextResponse.json({ error: 'At least one valid CRM lead email is required.' }, { status: 400 });
  }

  const enabled = typeof body.enabled === 'boolean' ? body.enabled : true;

  // One destination per provider per account (DB unique constraint). If one
  // already exists, tell the caller to edit it instead of 500-ing.
  const existing = await prisma.crmDestination.findUnique({
    where: { accountKey_provider: { accountKey: key, provider } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: `${provider} is already connected for this account.` },
      { status: 409 },
    );
  }

  const destination = await prisma.crmDestination.create({
    data: {
      accountKey: key,
      provider,
      leadEmails: stringifyLeadEmails(emails),
      enabled,
      createdByUserId: session!.user.id,
    },
  });

  return NextResponse.json({ destination: serializeDestination(destination) }, { status: 201 });
}
