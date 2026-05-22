import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

// GET /api/contacts/:id/activity?accountKey=&limit=
//
// Replaces /api/esp/contacts/:id/conversations. Returns Loomi-tracked
// email + SMS activity for a contact, sourced from EmailEvent and
// SmsEvent rows we already log via the SendGrid + Twilio webhooks.
//
// The response shape matches what the existing contact detail panel
// renders (`messages: ConvoMessage[]` + `stats`) so the consumer can
// flip from /conversations → /activity in Phase C with no reshaping.
// Fidelity caveat for the user: this only covers messages that
// flowed through Loomi. Replies to non-Loomi sends or out-of-band
// SMS exchanges with the dealer's GHL chat are NOT visible here —
// that's a known regression from the GHL conversations API, called
// out in the migration plan.

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type ChannelLabel = 'EMAIL' | 'SMS' | 'MMS';

interface ConvoMessage {
  id: string;
  channel: ChannelLabel;
  type: ChannelLabel;
  direction: 'inbound' | 'outbound';
  body: string;
  dateAdded: string;
  subject?: string;
  contentType?: string;
}

interface ConvoStats {
  totalMessages: number;
  smsCount: number;
  emailCount: number;
  lastMessageDate: string | null;
  lastMessageDirection: 'inbound' | 'outbound' | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin', 'client');
  if (error) return error;

  const { contactId } = await params;
  const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim() ?? '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  if (session!.user.role === 'client') {
    const assigned = session!.user.accountKeys ?? [];
    if (!assigned.includes(accountKey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_LIMIT, limitRaw))
    : DEFAULT_LIMIT;

  // The contact's phone number gives us the join key for orphan
  // SmsEvent rows (1:1 sends from the detail page + inbound STOP /
  // reply webhooks that hit before any recipientId was assigned).
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, accountKey },
    select: { phone: true },
  });
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  try {
    const [emailRecipients, smsRecipients, orphanSmsEvents] = await Promise.all([
      prisma.emailCampaignRecipient.findMany({
        where: { accountKey, contactId },
        select: {
          id: true,
          email: true,
          events: {
            select: {
              id: true,
              eventType: true,
              timestamp: true,
              url: true,
              reason: true,
            },
            orderBy: { timestamp: 'desc' },
          },
          campaign: { select: { subject: true } },
        },
      }),
      prisma.smsCampaignRecipient.findMany({
        where: { accountKey, contactId },
        select: {
          id: true,
          phone: true,
          events: {
            select: {
              id: true,
              eventType: true,
              timestamp: true,
              body: true,
            },
            orderBy: { timestamp: 'desc' },
          },
          campaign: { select: { message: true } },
        },
      }),
      // Orphan SmsEvent rows — 1:1 sends from /api/contacts/:id/sms
      // and any inbound webhooks where Twilio gave us a `from` we
      // can match to this contact's phone. recipientId is null
      // because there's no campaign recipient on the other side.
      contact.phone
        ? prisma.smsEvent.findMany({
            where: {
              accountKey,
              recipientId: null,
              OR: [{ to: contact.phone }, { from: contact.phone }],
            },
            select: {
              id: true,
              eventType: true,
              timestamp: true,
              body: true,
              from: true,
              to: true,
            },
            orderBy: { timestamp: 'desc' },
          })
        : Promise.resolve([]),
    ]);

    const messages: ConvoMessage[] = [];

    for (const recipient of emailRecipients) {
      const subject = recipient.campaign?.subject ?? '';
      for (const event of recipient.events) {
        const summary = describeEmailEvent(event.eventType, event.url, event.reason);
        if (!summary) continue;
        messages.push({
          id: `email:${event.id}`,
          channel: 'EMAIL',
          type: 'EMAIL',
          direction: 'outbound',
          body: summary,
          dateAdded: event.timestamp.toISOString(),
          subject,
          contentType: 'text/email',
        });
      }
    }

    for (const recipient of smsRecipients) {
      const campaignBody = recipient.campaign?.message ?? '';
      for (const event of recipient.events) {
        const direction = isInboundSms(event.eventType) ? 'inbound' : 'outbound';
        const body =
          (typeof event.body === 'string' && event.body.trim())
            ? event.body
            : campaignBody || describeSmsEvent(event.eventType);
        if (!body) continue;
        messages.push({
          id: `sms:${event.id}`,
          channel: 'SMS',
          type: 'SMS',
          direction,
          body,
          dateAdded: event.timestamp.toISOString(),
        });
      }
    }

    for (const event of orphanSmsEvents) {
      // For orphan events, inbound vs outbound is decided by which
      // side of the (from, to) pair the contact's phone sits on.
      // Receive-side webhooks set the contact phone as `from`;
      // outbound 1:1 sends set it as `to`.
      const direction = event.from === contact.phone ? 'inbound' : 'outbound';
      const body =
        (typeof event.body === 'string' && event.body.trim())
          ? event.body
          : describeSmsEvent(event.eventType);
      if (!body) continue;
      messages.push({
        id: `sms:${event.id}`,
        channel: 'SMS',
        type: 'SMS',
        direction,
        body,
        dateAdded: event.timestamp.toISOString(),
      });
    }

    messages.sort((a, b) => (a.dateAdded < b.dateAdded ? 1 : -1));
    const trimmed = messages.slice(0, limit);

    const stats = buildStats(messages);

    return NextResponse.json({
      messages: trimmed,
      stats,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch contact activity';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Event → human-readable summary ──

function describeEmailEvent(eventType: string, url: string | null, reason: string | null): string {
  switch (eventType) {
    case 'delivered':
      return 'Email delivered';
    case 'open':
      return 'Opened email';
    case 'click':
      return url ? `Clicked link: ${url}` : 'Clicked link';
    case 'bounce':
      return reason ? `Bounced: ${reason}` : 'Email bounced';
    case 'dropped':
      return reason ? `Dropped: ${reason}` : 'Email dropped';
    case 'spamreport':
      return 'Marked as spam';
    case 'unsubscribe':
      return 'Unsubscribed';
    case 'deferred':
      return reason ? `Deferred: ${reason}` : 'Email deferred';
    case 'processed':
      // Processed is a noisy queue-side event — skip in the activity feed.
      return '';
    default:
      return `Email event: ${eventType}`;
  }
}

function describeSmsEvent(eventType: string): string {
  switch (eventType) {
    case 'queued':
      return 'SMS queued';
    case 'sent':
      return 'SMS sent';
    case 'delivered':
      return 'SMS delivered';
    case 'undelivered':
      return 'SMS undelivered';
    case 'failed':
      return 'SMS failed';
    case 'received':
      return 'SMS received';
    case 'stop':
      return 'Contact replied STOP';
    case 'unsub':
      return 'Contact unsubscribed via SMS';
    default:
      return `SMS event: ${eventType}`;
  }
}

function isInboundSms(eventType: string): boolean {
  return eventType === 'received' || eventType === 'stop' || eventType === 'unsub';
}

function buildStats(messages: ConvoMessage[]): ConvoStats {
  const stats: ConvoStats = {
    totalMessages: messages.length,
    smsCount: 0,
    emailCount: 0,
    lastMessageDate: null,
    lastMessageDirection: null,
  };
  for (const msg of messages) {
    if (msg.channel === 'EMAIL') stats.emailCount += 1;
    else stats.smsCount += 1;
  }
  if (messages.length > 0) {
    // Messages are pre-sorted newest-first.
    stats.lastMessageDate = messages[0].dateAdded;
    stats.lastMessageDirection = messages[0].direction;
  }
  return stats;
}
