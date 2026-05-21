// Process Twilio status callbacks + inbound message webhooks.
//
// Twilio fires status callbacks as a message progresses through:
//   queued → sent → delivered (happy path)
//   queued → undelivered | failed (sad path)
// We persist each transition as its own SmsEvent row keyed by (sid,
// eventType) so a replayed callback is a no-op upsert. Terminal states
// also flip the originating SmsCampaignRecipient.status.
//
// Inbound STOP keywords go through the inbound webhook and produce
// SmsSuppression rows so the campaign scheduler drops those phones
// from future batches.

import { prisma } from '@/lib/prisma';

/** Status callback payload shape — Twilio sends these as form data. */
export interface TwilioStatusCallbackPayload {
  MessageSid: string;
  MessageStatus: string;
  To?: string;
  From?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  AccountSid?: string;
  /** Loomi accountKey routed through the StatusCallback URL query. */
  accountKey: string;
}

/** Inbound message webhook payload. */
export interface TwilioInboundPayload {
  MessageSid: string;
  From: string;
  To?: string;
  Body?: string;
  AccountSid?: string;
  accountKey: string;
}

// Status callback values that mean "terminal failure" — recipient row
// flips to 'failed' so the user sees what went wrong.
const FAILURE_STATUSES = new Set(['undelivered', 'failed']);

// STOP keywords that opt the recipient out (Twilio auto-handles these
// at the carrier level + suppresses future sends from the same Twilio
// account, but we mirror it locally so our recipient resolver respects
// it across the sub-account's campaign batches without a Twilio call).
const STOP_KEYWORDS = new Set([
  'stop',
  'stopall',
  'unsubscribe',
  'cancel',
  'end',
  'quit',
]);

/**
 * Persist a status-callback event. Returns true when a new row was
 * inserted (i.e. fresh insert path) so the caller can fire side
 * effects, false when it was a dedup'd replay.
 */
export async function processTwilioStatusCallback(
  payload: TwilioStatusCallbackPayload,
): Promise<boolean> {
  const sid = payload.MessageSid;
  const status = (payload.MessageStatus || '').toLowerCase();
  if (!sid || !status) return false;

  // Find the originating recipient row by Twilio Message SID. We store
  // it in EmailCampaignRecipient.messageId / SmsCampaignRecipient.messageId
  // when the send returns 202.
  const recipient = await prisma.smsCampaignRecipient.findFirst({
    where: { messageId: sid },
    select: { id: true, campaignId: true },
  });

  // Idempotent persist on (sid, eventType).
  let created = false;
  try {
    await prisma.smsEvent.create({
      data: {
        twilioMessageSid: sid,
        eventType: status,
        campaignId: recipient?.campaignId || null,
        recipientId: recipient?.id || null,
        accountKey: payload.accountKey || null,
        from: payload.From || null,
        to: payload.To || null,
        errorCode: payload.ErrorCode || null,
        errorMessage: payload.ErrorMessage || null,
        raw: JSON.stringify(payload),
        timestamp: new Date(),
      },
    });
    created = true;
  } catch (err) {
    // Unique violation on (sid, eventType) → already persisted.
    // Anything else is unexpected; rethrow.
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      return false;
    }
    throw err;
  }

  // Side effects on first-insert only.
  if (recipient && FAILURE_STATUSES.has(status)) {
    await prisma.smsCampaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: 'failed',
        error: `${status}${payload.ErrorMessage ? ': ' + payload.ErrorMessage : ''}`,
      },
    });

    // Undelivered messages often indicate a bad/dormant phone — auto-suppress
    // so we don't retry. errorCode 30003 = unreachable, 30005 = unknown
    // number, 30006 = landline. Distinguish from carrier-blocked (30007)
    // which still warrants a suppression entry.
    if (status === 'undelivered' && payload.To && payload.accountKey) {
      await persistSmsSuppression(payload.accountKey, payload.To, 'undelivered', payload);
    }
  }

  return created;
}

/**
 * Persist an inbound message. STOP keywords flip the sender's phone
 * onto the suppression list for this sub-account. Everything else is
 * logged but doesn't trigger side effects.
 */
export async function processTwilioInbound(
  payload: TwilioInboundPayload,
): Promise<{ logged: boolean; suppressed: boolean }> {
  const sid = payload.MessageSid;
  if (!sid) return { logged: false, suppressed: false };

  const body = (payload.Body || '').trim();
  const isStop = STOP_KEYWORDS.has(body.toLowerCase());
  const eventType = isStop ? 'stop' : 'received';

  let logged = false;
  try {
    await prisma.smsEvent.create({
      data: {
        twilioMessageSid: sid,
        eventType,
        accountKey: payload.accountKey || null,
        from: payload.From || null,
        to: payload.To || null,
        body,
        raw: JSON.stringify(payload),
        timestamp: new Date(),
      },
    });
    logged = true;
  } catch (err) {
    if (!(err instanceof Error && /unique|duplicate/i.test(err.message))) {
      throw err;
    }
  }

  let suppressed = false;
  if (logged && isStop && payload.From && payload.accountKey) {
    await persistSmsSuppression(payload.accountKey, payload.From, 'stop', payload);
    suppressed = true;
  }

  return { logged, suppressed };
}

async function persistSmsSuppression(
  accountKey: string,
  phone: string,
  reason: string,
  raw: unknown,
): Promise<void> {
  await prisma.smsSuppression.upsert({
    where: { accountKey_phone: { accountKey, phone } },
    create: {
      accountKey,
      phone,
      reason,
      source: 'twilio',
      raw: JSON.stringify(raw),
    },
    update: {
      reason,
      raw: JSON.stringify(raw),
    },
  });
}
