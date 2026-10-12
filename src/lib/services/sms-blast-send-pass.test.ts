import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The SMS send pass's batch selection: a batch is filled from recipients whose
// local quiet hours are OVER. Taking the first N pending rows instead would let
// a batch of held Pacific numbers block Eastern ones whose window is open — and
// rewrite every held row's note every minute.
//
// Also: a carrier-level STOP (Twilio 21610) is an opt-out, not an error.

const blastFindUnique = vi.fn();
const blastUpdateMany = vi.fn();
const recipientFindMany = vi.fn();
const recipientUpdateMany = vi.fn();
const sendSms = vi.fn();
const recordSmsOptOut = vi.fn(async (..._args: unknown[]) => ({}));

vi.mock('@/lib/sending/opt-outs', () => ({
  recordSmsOptOut: (...a: unknown[]) => recordSmsOptOut(...a),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    smsBlast: {
      findUnique: (...a: unknown[]) => blastFindUnique(...a),
      findUniqueOrThrow: vi.fn(async () => smsRow({ status: 'processing' })),
      update: vi.fn(async () => smsRow()),
      updateMany: (...a: unknown[]) => blastUpdateMany(...a),
    },
    smsBlastRecipient: {
      findMany: (...a: unknown[]) => recipientFindMany(...a),
      update: vi.fn(async () => ({})),
      updateMany: (...a: unknown[]) => recipientUpdateMany(...a),
      groupBy: vi.fn(async () => [{ status: 'pending', _count: { _all: 1 } }]),
      findFirst: vi.fn(async () => null),
    },
    account: {
      findMany: vi.fn(async () => [{ key: 'young-chev', dealer: 'Young Chevrolet', timezone: null }]),
    },
    contact: {
      findMany: vi.fn(async () => [
        { id: 'c-la', accountKey: 'young-chev', dnd: null },
        { id: 'c-ny', accountKey: 'young-chev', dnd: null },
      ]),
    },
  },
}));

vi.mock('@/lib/crypto/encryption', () => ({
  decryptToken: (v: string) => v,
  encryptToken: (v: string) => v,
}));

vi.mock('@/lib/sending/twilio', async () => {
  class TwilioError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly twilioCode?: number,
    ) {
      super(message);
    }
  }
  return {
    TwilioError,
    resolveTwilioConfig: vi.fn(async () => ({
      accountSid: 'AC1',
      authToken: 't',
      phoneNumber: '+18015550000',
      messagingServiceSid: null,
    })),
    sendSmsViaTwilio: (...a: unknown[]) => sendSms(...a),
  };
});

vi.mock('@/lib/sending/suppression-lookup', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sending/suppression-lookup')>(
    '@/lib/sending/suppression-lookup',
  );
  return { ...actual, loadSmsSuppressions: vi.fn(async () => () => null) };
});

const { processSmsBlast } = await import('./sms-blasts');
const { TwilioError } = await import('@/lib/sending/twilio');

function smsRow(overrides?: Record<string, unknown>) {
  return {
    id: 'sms-1',
    name: 'Fall Service',
    flowNodeKey: null,
    message: 'Fall service is here',
    status: 'scheduled',
    scheduledFor: null,
    startedAt: null,
    completedAt: null,
    totalRecipients: 2,
    sentCount: 0,
    failedCount: 0,
    undeliveredCount: 0,
    accountKeys: '["young-chev"]',
    sourceAudienceId: null,
    sourceFilter: null,
    sourceListId: null,
    sourceContactIds: null,
    metadata: null,
    createdAt: new Date('2026-10-12T12:00:00Z'),
    updatedAt: new Date('2026-10-12T12:00:00Z'),
    error: null,
    ...overrides,
  };
}

// A Los Angeles number first, then a New York one.
const pending = [
  {
    id: 'r-la',
    contactId: 'c-la',
    accountKey: 'young-chev',
    phone: '+14155550101',
    error: null,
    createdAt: new Date('2026-10-12T13:00:00Z'),
  },
  {
    id: 'r-ny',
    contactId: 'c-ny',
    accountKey: 'young-chev',
    phone: '+12125550102',
    error: null,
    createdAt: new Date('2026-10-12T13:00:00Z'),
  },
];

beforeEach(() => {
  // 14:00 UTC = 10:00 in New York (window open), 07:00 in Los Angeles (held).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-12T14:00:00Z'));
  for (const fn of [blastFindUnique, blastUpdateMany, recipientFindMany, recipientUpdateMany, sendSms]) {
    fn.mockReset();
  }
  blastFindUnique.mockImplementation(async (args: Record<string, unknown>) => {
    const select = (args.select ?? {}) as Record<string, boolean>;
    if (select.status && Object.keys(select).length === 1) return { status: 'processing' };
    return smsRow();
  });
  blastUpdateMany.mockResolvedValue({ count: 1 });
  recipientFindMany.mockResolvedValue(pending);
  recipientUpdateMany.mockResolvedValue({ count: 1 });
  sendSms.mockResolvedValue({ messageSid: 'SM1', status: 'queued' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SMS send pass', () => {
  it('fills the batch from open windows, past a held number at the front', async () => {
    await processSmsBlast('sms-1', { concurrency: 1, batchSize: 1 });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect((sendSms.mock.calls[0][0] as { to: string }).to).toBe('+12125550102');
    // The held Los Angeles row got its note, and stays pending.
    const laWrite = recipientUpdateMany.mock.calls
      .map(([a]) => a as { where: { id: string }; data: Record<string, unknown> })
      .find((a) => a.where.id === 'r-la');
    expect(laWrite?.data.status).toBeUndefined();
    expect(String(laWrite?.data.error)).toMatch(/^Holding until/);
  });

  it('does not rewrite a hold note that has not changed', async () => {
    await processSmsBlast('sms-1', { concurrency: 1 });
    const note = recipientUpdateMany.mock.calls
      .map(([a]) => a as { where: { id: string }; data: Record<string, unknown> })
      .find((a) => a.where.id === 'r-la')?.data.error as string;

    recipientUpdateMany.mockClear();
    recipientFindMany.mockResolvedValue([{ ...pending[0], error: note }]);
    await processSmsBlast('sms-1', { concurrency: 1 });
    expect(
      recipientUpdateMany.mock.calls.some(([a]) => (a as { where: { id: string } }).where.id === 'r-la'),
    ).toBe(false);
  });

  it('treats a carrier-level STOP as an opt-out, not a failure', async () => {
    recipientFindMany.mockResolvedValue([pending[1]]);
    sendSms.mockRejectedValue(new TwilioError('Attempt to send to unsubscribed recipient', 400, 21610));
    await processSmsBlast('sms-1', { concurrency: 1 });
    const write = recipientUpdateMany.mock.calls
      .map(([a]) => a as { where: { id: string }; data: Record<string, unknown> })
      .find((a) => a.where.id === 'r-ny');
    expect(write?.data).toMatchObject({ status: 'skipped' });
    expect(String(write?.data.error)).toMatch(/opted out/);
    // …and recorded as a STOP, so no later blast tries the number again.
    expect(recordSmsOptOut).toHaveBeenCalledWith(
      expect.objectContaining({ accountKey: 'young-chev', reason: 'stop', phone: '+12125550102' }),
    );
  });

  it('sends to the E.164 form of the number', async () => {
    recipientFindMany.mockResolvedValue([{ ...pending[1], phone: '(212) 555-0102' }]);
    await processSmsBlast('sms-1', { concurrency: 1 });
    expect((sendSms.mock.calls[0][0] as { to: string }).to).toBe('+12125550102');
  });
});
