import { NextRequest, NextResponse } from 'next/server';
import { verifySendGridWebhookSignature } from '@/lib/sending/sendgrid-webhook';
import {
  processSendGridEventBatch,
  type ProcessedEventOutcome,
} from '@/lib/sending/sendgrid-events';

const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

/**
 * POST /api/webhooks/sendgrid/events
 *
 * SendGrid Event Webhook entry point for Loomi-native sends.
 *
 * Configure this URL in SendGrid: Settings → Mail Settings → Event
 * Webhook → HTTP Post URL. Enable signed event webhook + add the
 * generated public key to env var SENDGRID_WEBHOOK_VERIFICATION_KEY so
 * signature verification works — one key per SendGrid account or subuser
 * that posts here (format in lib/sending/sendgrid-webhook.ts).
 *
 * The status code is how SendGrid learns whether to redeliver the batch:
 *
 *   2xx — every event was recorded, was already recorded, or was malformed.
 *         Malformed events are acknowledged and dropped: no retry can repair
 *         them, and refusing would have SendGrid redeliver them for as long
 *         as it keeps trying.
 *   500 — some event failed on OUR side (the database, mostly). That event
 *         rolled back whole, so the redelivery applies it cleanly, and each
 *         event that did commit is a no-op duplicate the second time round.
 *
 * This used to answer 200 regardless, to keep retries from piling up — which
 * turned every database hiccup into a permanently lost unsubscribe or bounce.
 * Idempotent, transactional processing (see processSendGridEventBatch) is what
 * makes asking for the retry safe.
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

  let events: unknown[];
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!Array.isArray(parsed)) {
      return NextResponse.json(
        { error: 'Expected an array of events' },
        { status: 400 },
      );
    }
    events = parsed;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (events.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let outcomes: ProcessedEventOutcome[];
  try {
    outcomes = await processSendGridEventBatch(events);
  } catch (err) {
    // The batch processor reports per-event failures rather than throwing,
    // so this is a bug — but still nothing SendGrid should be told succeeded.
    console.error('[sendgrid:webhook] batch processing threw', err);
    return NextResponse.json({ error: 'Event processing failed' }, { status: 500 });
  }

  const tally = (status: ProcessedEventOutcome['status']) =>
    outcomes.filter((o) => o.status === status).length;
  const summary = {
    processed: events.length,
    persisted: tally('persisted'),
    duplicates: tally('duplicate'),
    invalid: tally('invalid'),
    failed: tally('failed'),
  };

  if (summary.failed > 0) {
    const firstFailure = outcomes.find((o) => o.status === 'failed');
    console.error(
      `[sendgrid:webhook] ${summary.failed} of ${events.length} event(s) failed — answering 500 so SendGrid redelivers the batch (${summary.persisted} new, ${summary.duplicates} duplicate, ${summary.invalid} invalid). First failure: ${firstFailure?.sgEventId}: ${firstFailure?.reason ?? 'unknown error'}`,
    );
    return NextResponse.json(
      { error: 'Some events could not be recorded; redeliver the batch', ...summary },
      { status: 500 },
    );
  }

  if (summary.invalid > 0) {
    console.warn(
      `[sendgrid:webhook] processed ${summary.persisted} new, ${summary.duplicates} duplicate, ${summary.invalid} invalid out of ${events.length}`,
    );
  }

  return NextResponse.json(summary);
}
