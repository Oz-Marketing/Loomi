import { NextRequest, NextResponse } from 'next/server';
import { verifySendGridWebhookSignature } from '@/lib/sending/sendgrid-webhook';
import {
  processSendGridEventBatch,
  type SendGridEvent,
} from '@/lib/sending/sendgrid-events';

const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

/**
 * POST /api/webhooks/sendgrid/events
 *
 * SendGrid Event Webhook entry point for Loomi-native sends.
 *
 * Configure this URL in SendGrid: Settings → Mail Settings → Event
 * Webhook → HTTP Post URL. Enable signed event webhook + paste the
 * generated public key into env var SENDGRID_WEBHOOK_VERIFICATION_KEY
 * so signature verification works.
 *
 * SendGrid retries on any 5xx; the persist layer dedupes by
 * sg_event_id so retries are safe. We always respond 200 on a
 * successful verification + parse, even if individual events failed
 * to persist — the alternative is endless retries swamping the queue.
 */
export async function POST(req: NextRequest) {
  // Raw body is needed both for signature verification (timestamp +
  // body is the signed payload) and for parsing the events.
  const rawBody = await req.text();

  const signature = req.headers.get(SIGNATURE_HEADER);
  const timestamp = req.headers.get(TIMESTAMP_HEADER);

  // Require signature verification in production; let unsigned
  // requests through in dev so we can curl test payloads locally
  // without round-tripping through SendGrid.
  if (signature && timestamp) {
    const ok = verifySendGridWebhookSignature(rawBody, signature, timestamp);
    if (!ok) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Missing signature headers' },
      { status: 401 },
    );
  }

  let events: SendGridEvent[];
  try {
    const parsed = JSON.parse(rawBody);
    if (!Array.isArray(parsed)) {
      return NextResponse.json(
        { error: 'Expected an array of events' },
        { status: 400 },
      );
    }
    events = parsed as SendGridEvent[];
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (events.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  const outcomes = await processSendGridEventBatch(events);
  const persisted = outcomes.filter((o) => o.status === 'persisted').length;
  const duplicates = outcomes.filter((o) => o.status === 'duplicate').length;
  const invalid = outcomes.filter((o) => o.status === 'invalid').length;

  if (invalid > 0) {
    console.warn(
      `[sendgrid:webhook] processed ${persisted} new, ${duplicates} duplicate, ${invalid} invalid out of ${events.length}`,
    );
  }

  return NextResponse.json({
    processed: events.length,
    persisted,
    duplicates,
    invalid,
  });
}
