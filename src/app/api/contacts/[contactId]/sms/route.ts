import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  resolveTwilioConfig,
  sendSmsViaTwilio,
  TwilioError,
} from '@/lib/sending/twilio';

// POST /api/contacts/:id/sms?accountKey=
//
// Ad-hoc 1:1 SMS / MMS send from the contact detail page. Goes
// through the same Twilio direct engine as bulk SMS campaigns but
// does NOT create an SmsCampaign — we don't want every "hey, your
// car's ready" message to show up in the campaigns list.
//
// The send is logged as an orphan SmsEvent row (recipientId NULL,
// campaignId NULL) so the contact activity feed can surface it and
// status-callback events for the same twilioMessageSid can chain
// onto it.
//
// Request: { channel: 'SMS' | 'MMS', message: string, mediaUrls?: string[] }
// Response: { message: ConvoMessage }  — shape matches /activity so the
//   UI can optimistically prepend the sent message.

type RouteContext = { params: Promise<{ contactId: string }> };

const MAX_BODY = 640;
const MAX_MEDIA = 10;

interface ConvoMessage {
  id: string;
  channel: 'SMS' | 'MMS';
  type: 'SMS' | 'MMS';
  direction: 'outbound';
  body: string;
  dateAdded: string;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { contactId } = await params;
  const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim() ?? '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  if (session!.user.role === 'admin') {
    const assigned = session!.user.accountKeys ?? [];
    if (assigned.length > 0 && !assigned.includes(accountKey)) {
      return NextResponse.json({ error: 'Forbidden for this account' }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }

  const channelRaw = typeof body.channel === 'string' ? body.channel.toUpperCase() : 'SMS';
  const channel: 'SMS' | 'MMS' = channelRaw === 'MMS' ? 'MMS' : 'SMS';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const mediaUrls = parseMediaUrls(body.mediaUrls);

  if (!message && mediaUrls.length === 0) {
    return NextResponse.json(
      { error: `Provide a ${channel} body or at least one media URL` },
      { status: 400 },
    );
  }
  if (message.length > MAX_BODY) {
    return NextResponse.json(
      { error: `Message exceeds ${MAX_BODY}-character limit` },
      { status: 400 },
    );
  }
  if (mediaUrls.length > MAX_MEDIA) {
    return NextResponse.json(
      { error: `Twilio accepts at most ${MAX_MEDIA} media URLs per message` },
      { status: 400 },
    );
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, accountKey },
    select: { id: true, phone: true },
  });
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }
  if (!contact.phone) {
    return NextResponse.json(
      { error: 'Contact has no phone number on file' },
      { status: 400 },
    );
  }

  // Suppression gate. Manual suppression via /suppression and STOP
  // replies via the inbound webhook both land in SmsSuppression — we
  // don't differentiate here, both block.
  const suppressed = await prisma.smsSuppression.findUnique({
    where: { accountKey_phone: { accountKey, phone: contact.phone } },
    select: { reason: true },
  });
  if (suppressed) {
    return NextResponse.json(
      { error: `This contact is on the SMS suppression list (${suppressed.reason}).` },
      { status: 409 },
    );
  }

  const twilio = await resolveTwilioConfig(accountKey);
  if (!twilio) {
    return NextResponse.json(
      { error: 'Twilio is not configured for this account. Set credentials in Sending settings.' },
      { status: 412 },
    );
  }

  const statusCallback = buildStatusCallbackUrl(accountKey);
  const sentAt = new Date();

  let messageSid: string;
  try {
    const result = await sendSmsViaTwilio({
      accountSid: twilio.accountSid,
      authToken: twilio.authToken,
      from: {
        phoneNumber: twilio.phoneNumber,
        messagingServiceSid: twilio.messagingServiceSid,
      },
      to: contact.phone,
      body: message,
      mediaUrls,
      statusCallback,
    });
    messageSid = result.messageSid;
  } catch (err) {
    if (err instanceof TwilioError) {
      return NextResponse.json({ error: err.message }, { status: err.status >= 400 ? err.status : 502 });
    }
    const errMessage = err instanceof Error ? err.message : 'Twilio send failed';
    return NextResponse.json({ error: errMessage }, { status: 502 });
  }

  // Log as an orphan SmsEvent (no recipientId / campaignId). Status
  // callbacks for the same SID will land alongside this row and the
  // activity feed picks them all up via the (accountKey, to) match.
  await prisma.smsEvent.create({
    data: {
      accountKey,
      eventType: 'sent',
      twilioMessageSid: messageSid,
      from: twilio.messagingServiceSid || twilio.phoneNumber || null,
      to: contact.phone,
      body: message || null,
      raw: JSON.stringify({
        source: '1to1',
        channel,
        mediaUrls,
      }),
      timestamp: sentAt,
    },
  });

  const sentMessage: ConvoMessage = {
    id: `sms:${messageSid}`,
    channel,
    type: channel,
    direction: 'outbound',
    body: message,
    dateAdded: sentAt.toISOString(),
  };

  return NextResponse.json({ message: sentMessage });
}

// Same logic as buildStatusCallbackUrl in sms-campaigns.ts, inlined
// here because that helper is private to that file. Phase D may
// consolidate as part of the broader sending-module cleanup.
function buildStatusCallbackUrl(accountKey: string): string | undefined {
  const origin = process.env.APP_PUBLIC_URL || process.env.NEXTAUTH_URL || '';
  if (!origin) return undefined;
  return `${origin.replace(/\/$/, '')}/api/webhooks/twilio/status?accountKey=${encodeURIComponent(accountKey)}`;
}

function parseMediaUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((url) => /^https?:\/\/\S+$/i.test(url))
    .slice(0, MAX_MEDIA);
}
