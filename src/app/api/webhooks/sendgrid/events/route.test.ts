import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The response code is the only thing SendGrid reads: 2xx means "done",
 * anything else means "deliver this batch again later". This route used to
 * answer 200 even when events failed to record, so a database blip silently
 * lost whatever unsubscribes and bounces were in the batch. A failure on our
 * side now answers 500; a malformed event is still acknowledged, because no
 * redelivery can fix it.
 *
 * Prisma is mocked; the event processing under it is the real module.
 */

const transaction = vi.fn();
const eventCreateMany = vi.fn();
const recipientFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (...a: unknown[]) => transaction(...a),
    emailEvent: { createMany: (...a: unknown[]) => eventCreateMany(...a) },
    emailBlastRecipient: { findMany: (...a: unknown[]) => recipientFindMany(...a) },
  },
}));
vi.mock('@/lib/services/accounts', () => ({ getRelatedAccountKeys: async () => [] }));

import { POST } from './route';

const URL = 'https://studio.loomilm.com/api/webhooks/sendgrid/events';

function post(events: unknown, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest(URL, {
      method: 'POST',
      body: typeof events === 'string' ? events : JSON.stringify(events),
      headers: { 'content-type': 'application/json', ...headers },
    }),
  );
}

const hardBounce = {
  event: 'bounce',
  sg_event_id: 'evt-bounce',
  sg_message_id: 'Xk2ab9QtR0aBcD.filterdrecv-5bf99c48d-wbsbg-20-5DA8F2D9-24.0',
  email: 'pat@example.com',
  timestamp: 1_760_280_000,
  type: 'bounce',
  bounce_classification: 'Invalid Address',
  reason: '550 5.1.1 user unknown',
  campaignId: 'blast-1',
  recipientId: 'r-1',
  accountKey: 'young-chev',
};

const processed = { event: 'processed', sg_event_id: 'evt-processed', email: 'pat@example.com' };

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  transaction.mockReset();
  eventCreateMany.mockReset().mockResolvedValue({ count: 1 });
  recipientFindMany.mockReset().mockResolvedValue([
    { id: 'r-1', campaignId: 'blast-1', accountKey: 'young-chev', email: 'pat@example.com' },
  ]);
  // A failure is logged loudly on purpose; keep it out of the test output.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/webhooks/sendgrid/events — what SendGrid is told', () => {
  it('answers 500 when the database fails mid-event, so SendGrid redelivers', async () => {
    transaction.mockRejectedValue(new Error('Connection terminated unexpectedly'));

    const res = await post([hardBounce]);

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ failed: 1, persisted: 0 });
  });

  it('answers 500 when the recipient lookup fails before anything is written', async () => {
    recipientFindMany.mockRejectedValue(new Error('too many clients already'));

    const res = await post([hardBounce, processed]);

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ failed: 2 });
    expect(eventCreateMany).not.toHaveBeenCalled();
  });

  it('answers 500 for the whole batch when only one event failed', async () => {
    // The committed ones are duplicates on redelivery; only the failure is
    // applied the second time.
    transaction.mockRejectedValue(new Error('deadlock detected'));

    const res = await post([processed, hardBounce]);

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ persisted: 1, failed: 1 });
  });

  it('acknowledges a batch whose only problem is malformed events', async () => {
    const res = await post([{ event: 'open' }, { sg_event_id: 'evt-no-type' }, null]);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ invalid: 3, failed: 0 });
  });

  it('answers 200 for a clean batch, and for one it has already seen', async () => {
    const clean = await post([processed]);
    expect(clean.status).toBe(200);
    expect(await clean.json()).toMatchObject({ persisted: 1, duplicates: 0 });

    eventCreateMany.mockResolvedValue({ count: 0 });
    const replay = await post([processed]);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ persisted: 0, duplicates: 1 });
  });

  it('runs a bounce through one transaction, and reports it persisted', async () => {
    transaction.mockResolvedValue('persisted');

    const res = await post([hardBounce]);

    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ persisted: 1 });
  });
});

describe('POST /api/webhooks/sendgrid/events — signatures', () => {
  function keyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    return {
      base64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      sign: (payload: string) => crypto.sign('sha256', Buffer.from(payload), privateKey).toString('base64'),
    };
  }

  it('accepts a batch signed by the second configured SendGrid account', async () => {
    const accountA = keyPair();
    const accountB = keyPair();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SENDGRID_WEBHOOK_VERIFICATION_KEY', `${accountA.base64},${accountB.base64}`);

    const body = JSON.stringify([processed]);
    const timestamp = '1760280000';
    const res = await post(body, {
      'x-twilio-email-event-webhook-signature': accountB.sign(timestamp + body),
      'x-twilio-email-event-webhook-timestamp': timestamp,
    });

    expect(res.status).toBe(200);
  });

  it('still refuses an unsigned batch in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await post([processed]);
    expect(res.status).toBe(401);
    expect(eventCreateMany).not.toHaveBeenCalled();
  });
});
