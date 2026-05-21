import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  setSendGridApiKey,
  setSendGridFromDomain,
} from '@/lib/sending/sendgrid';

interface RouteParams {
  params: Promise<{ key: string }>;
}

const MANAGEMENT_ROLES = ['developer', 'super_admin', 'admin'] as const;

/**
 * GET /api/accounts/[key]/sendgrid
 *
 * Returns whether the sub-account has a SendGrid key configured plus
 * the verified-from-domain hint. Never returns the key itself.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { key } = await params;
  if (session!.user.role === 'admin' && !session!.user.accountKeys.includes(key)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const row = await prisma.account.findUnique({
    where: { key },
    select: { sendgridApiKey: true, sendgridFromDomain: true },
  });
  if (!row) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  return NextResponse.json({
    configured: Boolean(row.sendgridApiKey),
    fromDomain: row.sendgridFromDomain || null,
  });
}

/**
 * PUT /api/accounts/[key]/sendgrid
 *
 * Body: { apiKey?: string | null, fromDomain?: string | null }
 *
 * - Passing apiKey as a non-empty string encrypts + persists the key.
 * - Passing apiKey: null clears it (sub-account falls back to SMTP).
 * - fromDomain is optional informational metadata used by the worker
 *   to warn at send time if senderEmail doesn't match.
 *
 * We deliberately don't accept the key on the general /api/accounts
 * PATCH so plaintext never touches code paths that handle generic
 * account fields.
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { key } = await params;
  if (session!.user.role === 'admin' && !session!.user.accountKeys.includes(key)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  if ('apiKey' in body) {
    const value = body.apiKey;
    if (value === null) {
      await setSendGridApiKey(key, null);
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed.startsWith('SG.')) {
        return NextResponse.json(
          { error: 'SendGrid API keys start with "SG.".' },
          { status: 400 },
        );
      }
      await setSendGridApiKey(key, trimmed);
    } else {
      return NextResponse.json({ error: 'Invalid apiKey value' }, { status: 400 });
    }
  }

  if ('fromDomain' in body) {
    const value = body.fromDomain;
    if (value === null || value === '') {
      await setSendGridFromDomain(key, null);
    } else if (typeof value === 'string') {
      await setSendGridFromDomain(key, value.trim());
    } else {
      return NextResponse.json({ error: 'Invalid fromDomain value' }, { status: 400 });
    }
  }

  const row = await prisma.account.findUnique({
    where: { key },
    select: { sendgridApiKey: true, sendgridFromDomain: true },
  });
  return NextResponse.json({
    configured: Boolean(row?.sendgridApiKey),
    fromDomain: row?.sendgridFromDomain || null,
  });
}
