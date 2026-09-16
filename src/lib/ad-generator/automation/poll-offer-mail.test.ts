// The whole point of the outbox: a morning sweep over N rooftops must produce
// ONE email per reviewer, not N. Prisma and the mail senders are mocked, so
// this asserts the routing — how many messages, of which shape — with no DB.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NotificationEmailItem } from '@/lib/notifications/email';

const sendImmediate = vi.fn().mockResolvedValue(true);
const sendDigest = vi.fn().mockResolvedValue(true);
const findUnique = vi.fn();
const updateMany = vi.fn().mockResolvedValue({ count: 0 });

vi.mock('@/lib/notifications/email', () => ({
  sendImmediateNotificationEmail: (...args: unknown[]) => sendImmediate(...args),
  sendDigestNotificationEmail: (...args: unknown[]) => sendDigest(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUnique(...args) },
    notification: { updateMany: (...args: unknown[]) => updateMany(...args) },
  },
}));

const { createOfferMailOutbox, flushOfferMail } = await import('./poll-offers');

const item = (title: string): NotificationEmailItem => ({
  title,
  body: 'New offers landed for Tucson, Santa Fe.',
  link: '/ad-generator',
  severity: 'info',
});

beforeEach(() => {
  vi.clearAllMocks();
  sendImmediate.mockResolvedValue(true);
  sendDigest.mockResolvedValue(true);
  findUnique.mockResolvedValue({ email: 'connor@ozmktg.com', name: 'Connor Kelly' });
  updateMany.mockResolvedValue({ count: 0 });
});

describe('flushOfferMail', () => {
  it('sends ONE digest for a sweep that touched several accounts', async () => {
    // This is the bug being fixed: three rooftops polled in one sweep used to
    // send three near-identical emails within a minute of each other.
    const outbox = createOfferMailOutbox();
    outbox.set('u1', {
      notificationIds: ['n1', 'n2', 'n3'],
      items: [
        item('Young Hyundai · 8 new Hyundai offers published'),
        item('Young Ford · 1 new Ford offer published'),
        item('Young Chrysler · 1 new Chrysler offer published'),
      ],
      makes: ['Hyundai', 'Ford', 'Chrysler'],
      offers: 10,
    });

    await flushOfferMail(outbox);

    expect(sendImmediate).not.toHaveBeenCalled();
    expect(sendDigest).toHaveBeenCalledTimes(1);
    const sent = sendDigest.mock.calls[0][0];
    expect(sent.items).toHaveLength(3);
    expect(sent.heading).toBe('10 new offers published — Hyundai, Ford, Chrysler');
    expect(sent.subject).toBe('[Loomi Studio] 10 new offers published — Hyundai, Ford, Chrysler');
    expect(sent.intro).toContain('on 3 accounts');
  });

  it('keeps the plain single-item email when only one account had news', async () => {
    // A digest shell wrapped around one card is a card with a redundant heading.
    const outbox = createOfferMailOutbox();
    outbox.set('u1', {
      notificationIds: ['n1'],
      items: [item('Young Hyundai · 8 new Hyundai offers published')],
      makes: ['Hyundai'],
      offers: 8,
    });

    await flushOfferMail(outbox);

    expect(sendDigest).not.toHaveBeenCalled();
    expect(sendImmediate).toHaveBeenCalledTimes(1);
  });

  it('mails each recipient separately', async () => {
    const outbox = createOfferMailOutbox();
    outbox.set('u1', {
      notificationIds: ['n1', 'n2'],
      items: [item('A · 2 new Honda offers published'), item('B · 1 new Ford offer published')],
      makes: ['Honda', 'Ford'],
      offers: 3,
    });
    outbox.set('u2', {
      notificationIds: ['n3', 'n4'],
      items: [item('A · 2 new Honda offers published'), item('B · 1 new Ford offer published')],
      makes: ['Honda', 'Ford'],
      offers: 3,
    });

    await flushOfferMail(outbox);

    expect(sendDigest).toHaveBeenCalledTimes(2);
  });

  it('stamps emailedAt on every notification the message covered', async () => {
    const outbox = createOfferMailOutbox();
    outbox.set('u1', {
      notificationIds: ['n1', 'n2'],
      items: [item('A · 2 new Honda offers published'), item('B · 1 new Ford offer published')],
      makes: ['Honda', 'Ford'],
      offers: 3,
    });

    await flushOfferMail(outbox);

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: { in: ['n1', 'n2'] } });
  });

  it('does NOT stamp emailedAt when the send no-opped', async () => {
    // SMTP unconfigured returns false. `emailedAt` is the one field an audit
    // would trust, so it must never claim a delivery that did not happen.
    sendDigest.mockResolvedValue(false);
    const outbox = createOfferMailOutbox();
    outbox.set('u1', {
      notificationIds: ['n1', 'n2'],
      items: [item('A · 2 new Honda offers published'), item('B · 1 new Ford offer published')],
      makes: ['Honda', 'Ford'],
      offers: 3,
    });

    await flushOfferMail(outbox);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('carries on when one recipient fails', async () => {
    // Best-effort: one bad address must not cost everyone else their mail.
    sendDigest.mockRejectedValueOnce(new Error('550 mailbox unavailable'));
    const entry = {
      notificationIds: ['n1', 'n2'],
      items: [item('A · 2 new Honda offers published'), item('B · 1 new Ford offer published')],
      makes: ['Honda', 'Ford'],
      offers: 3,
    };
    const outbox = createOfferMailOutbox();
    outbox.set('u1', { ...entry });
    outbox.set('u2', { ...entry });

    await expect(flushOfferMail(outbox)).resolves.toBeUndefined();
    expect(sendDigest).toHaveBeenCalledTimes(2);
  });

  it('skips a recipient with no email address', async () => {
    findUnique.mockResolvedValue(null);
    const outbox = createOfferMailOutbox();
    outbox.set('u1', {
      notificationIds: ['n1'],
      items: [item('A · 1 new Honda offer published')],
      makes: ['Honda'],
      offers: 1,
    });

    await flushOfferMail(outbox);

    expect(sendImmediate).not.toHaveBeenCalled();
    expect(sendDigest).not.toHaveBeenCalled();
  });
});
