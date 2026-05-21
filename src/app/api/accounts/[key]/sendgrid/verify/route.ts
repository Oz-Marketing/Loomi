import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/esp/encryption';
import { verifySendGridKey, checkSendGridDomain } from '@/lib/sending/sendgrid';

interface RouteParams {
  params: Promise<{ key: string }>;
}

const MANAGEMENT_ROLES = ['developer', 'super_admin', 'admin'] as const;

/**
 * POST /api/accounts/[key]/sendgrid/verify
 *
 * Body: { apiKey?: string }
 *
 * Two modes:
 * - If apiKey is provided, verify that key without persisting it. Use
 *   case: the settings UI lets the user paste a key and click "Verify
 *   Connection" before deciding to save.
 * - If apiKey is omitted, verify the currently-stored key. Use case:
 *   "is my saved config still working?" check.
 *
 * Also reports domain auth status when sendgridFromDomain is set on the
 * account (or when fromDomain is passed in the body alongside apiKey).
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { key } = await params;
  if (session!.user.role === 'admin' && !session!.user.accountKeys.includes(key)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const bodyKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const bodyDomain = typeof body.fromDomain === 'string' ? body.fromDomain.trim() : '';

  let plaintextKey: string | null = null;
  let domain: string | null = null;

  if (bodyKey) {
    plaintextKey = bodyKey;
    domain = bodyDomain || null;
  } else {
    const row = await prisma.account.findUnique({
      where: { key },
      select: { sendgridApiKey: true, sendgridFromDomain: true },
    });
    if (!row?.sendgridApiKey) {
      return NextResponse.json(
        { ok: false, error: 'No SendGrid API key configured for this sub-account.' },
        { status: 400 },
      );
    }
    try {
      plaintextKey = decryptToken(row.sendgridApiKey);
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Stored API key could not be decrypted (re-save it).' },
        { status: 500 },
      );
    }
    domain = row.sendgridFromDomain || null;
  }

  if (!plaintextKey) {
    return NextResponse.json(
      { ok: false, error: 'No API key to verify.' },
      { status: 400 },
    );
  }
  const verify = await verifySendGridKey(plaintextKey);
  let domainStatus = null;
  if (verify.ok && domain) {
    domainStatus = await checkSendGridDomain(plaintextKey, domain);
  }

  return NextResponse.json({
    ok: verify.ok,
    error: verify.error,
    scopes: verify.scopes,
    domain: domainStatus,
  });
}
