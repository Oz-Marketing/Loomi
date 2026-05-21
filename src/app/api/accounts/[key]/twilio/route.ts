import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { setTwilioCredentials } from '@/lib/sending/twilio';

interface RouteParams {
  params: Promise<{ key: string }>;
}

const MANAGEMENT_ROLES = ['developer', 'super_admin', 'admin'] as const;

/**
 * GET /api/accounts/[key]/twilio
 *
 * Returns whether the sub-account has Twilio configured and the
 * non-sensitive routing metadata. The Account SID + Auth Token are
 * never returned — only a boolean indicating they're set.
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
    select: {
      twilioAccountSid: true,
      twilioAuthToken: true,
      twilioPhoneNumber: true,
      twilioMessagingServiceSid: true,
    },
  });
  if (!row) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  return NextResponse.json({
    configured: Boolean(row.twilioAccountSid && row.twilioAuthToken),
    phoneNumber: row.twilioPhoneNumber || null,
    messagingServiceSid: row.twilioMessagingServiceSid || null,
  });
}

/**
 * PUT /api/accounts/[key]/twilio
 *
 * Body: { accountSid?, authToken?, phoneNumber?, messagingServiceSid? }
 *
 * Each field is independently updatable. Passing accountSid: null or
 * authToken: null clears the credential pair (sub-account falls back
 * to the legacy GHL Conversations API path). phoneNumber and
 * messagingServiceSid are non-sensitive routing metadata.
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { key } = await params;
  if (session!.user.role === 'admin' && !session!.user.accountKeys.includes(key)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const update: Parameters<typeof setTwilioCredentials>[1] = {};

  if ('accountSid' in body) {
    const v = body.accountSid;
    if (v === null) update.accountSid = null;
    else if (typeof v === 'string') {
      const trimmed = v.trim();
      if (!trimmed.startsWith('AC')) {
        return NextResponse.json({ error: 'Twilio Account SIDs start with "AC".' }, { status: 400 });
      }
      update.accountSid = trimmed;
    } else {
      return NextResponse.json({ error: 'Invalid accountSid value' }, { status: 400 });
    }
  }

  if ('authToken' in body) {
    const v = body.authToken;
    if (v === null) update.authToken = null;
    else if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed.length < 16) {
        return NextResponse.json({ error: 'Twilio Auth Tokens are at least 32 characters.' }, { status: 400 });
      }
      update.authToken = trimmed;
    } else {
      return NextResponse.json({ error: 'Invalid authToken value' }, { status: 400 });
    }
  }

  if ('phoneNumber' in body) {
    const v = body.phoneNumber;
    if (v === null || v === '') update.phoneNumber = null;
    else if (typeof v === 'string') {
      const trimmed = v.trim();
      // Twilio uses E.164; reject anything obviously off.
      if (!/^\+\d{8,15}$/.test(trimmed)) {
        return NextResponse.json(
          { error: 'Phone number must be in E.164 format (e.g. +12025551234).' },
          { status: 400 },
        );
      }
      update.phoneNumber = trimmed;
    } else {
      return NextResponse.json({ error: 'Invalid phoneNumber value' }, { status: 400 });
    }
  }

  if ('messagingServiceSid' in body) {
    const v = body.messagingServiceSid;
    if (v === null || v === '') update.messagingServiceSid = null;
    else if (typeof v === 'string') {
      const trimmed = v.trim();
      if (!trimmed.startsWith('MG')) {
        return NextResponse.json(
          { error: 'Messaging Service SIDs start with "MG".' },
          { status: 400 },
        );
      }
      update.messagingServiceSid = trimmed;
    } else {
      return NextResponse.json({ error: 'Invalid messagingServiceSid value' }, { status: 400 });
    }
  }

  await setTwilioCredentials(key, update);

  const row = await prisma.account.findUnique({
    where: { key },
    select: {
      twilioAccountSid: true,
      twilioAuthToken: true,
      twilioPhoneNumber: true,
      twilioMessagingServiceSid: true,
    },
  });
  return NextResponse.json({
    configured: Boolean(row?.twilioAccountSid && row?.twilioAuthToken),
    phoneNumber: row?.twilioPhoneNumber || null,
    messagingServiceSid: row?.twilioMessagingServiceSid || null,
  });
}
