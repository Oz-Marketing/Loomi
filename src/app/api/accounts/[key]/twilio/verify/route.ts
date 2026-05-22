import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/crypto/encryption';
import { verifyTwilioCredentials } from '@/lib/sending/twilio';

interface RouteParams {
  params: Promise<{ key: string }>;
}

const MANAGEMENT_ROLES = ['developer', 'super_admin', 'admin'] as const;

/**
 * POST /api/accounts/[key]/twilio/verify
 *
 * Body: { accountSid?, authToken? }
 *
 * If both fields are provided, verify the pasted-but-unsaved pair
 * without persisting. Otherwise verify the currently-stored creds.
 * Pings GET /Accounts/{sid}.json — cheap and side-effect-free.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { key } = await params;
  if (session!.user.role === 'admin' && !session!.user.accountKeys.includes(key)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const bodySid = typeof body.accountSid === 'string' ? body.accountSid.trim() : '';
  const bodyToken = typeof body.authToken === 'string' ? body.authToken.trim() : '';

  let sid = '';
  let token = '';

  if (bodySid && bodyToken) {
    sid = bodySid;
    token = bodyToken;
  } else {
    const row = await prisma.account.findUnique({
      where: { key },
      select: { twilioAccountSid: true, twilioAuthToken: true },
    });
    if (!row?.twilioAccountSid || !row?.twilioAuthToken) {
      return NextResponse.json(
        { ok: false, error: 'No Twilio credentials configured for this sub-account.' },
        { status: 400 },
      );
    }
    try {
      sid = decryptToken(row.twilioAccountSid);
      token = decryptToken(row.twilioAuthToken);
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Stored Twilio credentials could not be decrypted (re-save them).' },
        { status: 500 },
      );
    }
  }

  const result = await verifyTwilioCredentials(sid, token);
  return NextResponse.json(result);
}
