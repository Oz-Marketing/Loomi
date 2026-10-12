import { beforeEach, describe, expect, it, vi } from 'vitest';

// Blasts had a 5,000-recipient ceiling until 2026-10-12. It kept every query
// sized by an audience under Postgres's 65,535 bind-parameter limit and every
// schedule write inside Prisma's 5s interactive-transaction default — by
// accident. With the ceiling gone, both have to hold for an audience of any
// size, so this schedules one well past the old cap and checks the shape of
// every statement it produces.
//
// Prisma is mocked; what's under test is how the work is sliced.

const AUDIENCE = 12_345;
const SLICE = 5000;

// Opt-outs are read through one raw lookup (lib/sending/suppression-lookup);
// each call carries one slice of addresses as bind values.
const suppressionQuery = vi.fn();
const emailRecipientCreateMany = vi.fn();
const smsRecipientCreateMany = vi.fn();
const transactionOptions: unknown[] = [];

const txClient = {
  emailBlast: {
    updateMany: vi.fn(async () => ({ count: 1 })),
    update: vi.fn(async () => summaryRow()),
  },
  emailBlastRecipient: {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    createMany: (...a: unknown[]) => emailRecipientCreateMany(...a),
  },
  smsBlast: {
    updateMany: vi.fn(async () => ({ count: 1 })),
    update: vi.fn(async () => summaryRow()),
  },
  smsBlastRecipient: {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    createMany: (...a: unknown[]) => smsRecipientCreateMany(...a),
  },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (fn: (tx: typeof txClient) => Promise<unknown>, options?: unknown) => {
      transactionOptions.push(options);
      return fn(txClient);
    },
    $queryRaw: (...a: unknown[]) => suppressionQuery(...a),
    // The account hierarchy behind group-wide opt-outs: no groups here.
    account: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('@/lib/crypto/encryption', () => ({
  decryptToken: (v: string) => v,
  encryptToken: (v: string) => v,
}));

const { scheduleEmailBlastDraft } = await import('./email-blasts');
const { scheduleSmsBlastDraft } = await import('./sms-blasts');

function summaryRow() {
  return {
    id: 'blast-1',
    name: 'Fall Service Offer',
    flowNodeKey: null,
    subject: 'Fall service',
    previewText: null,
    sourceType: 'template-library',
    message: 'Fall service',
    status: 'scheduled',
    scheduledFor: new Date('2027-01-05T15:00:00Z'),
    startedAt: null,
    completedAt: null,
    totalRecipients: AUDIENCE,
    sentCount: 0,
    failedCount: 0,
    accountKeys: '["young-powersports"]',
    sourceAudienceId: null,
    sourceFilter: null,
    sourceListId: null,
    sourceContactIds: null,
    htmlContent: '<p>Body</p>',
    textContent: null,
    metadata: null,
    createdAt: new Date('2026-10-12T12:00:00Z'),
    updatedAt: new Date('2026-10-12T12:00:00Z'),
    error: null,
  };
}

/** Bind values carried by one raw opt-out query. */
function bindCount(sql: unknown): number {
  return ((sql as { values?: unknown[] }).values ?? []).length;
}

beforeEach(() => {
  for (const fn of [suppressionQuery, emailRecipientCreateMany, smsRecipientCreateMany]) {
    fn.mockReset();
  }
  transactionOptions.length = 0;
  suppressionQuery.mockResolvedValue([]);
  emailRecipientCreateMany.mockResolvedValue({ count: 0 });
  smsRecipientCreateMany.mockResolvedValue({ count: 0 });
});

describe('scheduling an audience past the old 5,000 cap', () => {
  it('writes every email recipient, in slices, inside a long-enough transaction', async () => {
    const recipients = Array.from({ length: AUDIENCE }, (_, i) => ({
      contactId: `c${i}`,
      accountKey: 'young-powersports',
      email: `rider${i}@gmail.com`,
      fullName: `Rider ${i}`,
    }));

    await scheduleEmailBlastDraft('blast-1', {
      recipients,
      scheduledFor: new Date('2027-01-05T15:00:00Z'),
    });

    const inserted = emailRecipientCreateMany.mock.calls.map(
      ([arg]) => (arg as { data: unknown[] }).data,
    );
    expect(inserted.reduce((n, rows) => n + rows.length, 0)).toBe(AUDIENCE);
    expect(Math.max(...inserted.map((rows) => rows.length))).toBeLessThanOrEqual(SLICE);

    // Sliced: several lookups, none anywhere near the bind-parameter limit
    // (one slice of addresses plus the account keys).
    const lookups = suppressionQuery.mock.calls.map(([sql]) => bindCount(sql));
    expect(lookups.length).toBeGreaterThan(1);
    expect(Math.max(...lookups)).toBeLessThanOrEqual(SLICE + 10);

    const options = transactionOptions[0] as { timeout?: number } | undefined;
    expect(options?.timeout ?? 0).toBeGreaterThanOrEqual(60_000);
  });

  it('writes every SMS recipient, in slices, inside a long-enough transaction', async () => {
    const recipients = Array.from({ length: AUDIENCE }, (_, i) => ({
      contactId: `c${i}`,
      accountKey: 'young-powersports',
      phone: `+1801555${String(i).padStart(4, '0')}`,
      fullName: `Rider ${i}`,
    }));

    await scheduleSmsBlastDraft('blast-1', {
      recipients,
      scheduledFor: new Date('2027-01-05T15:00:00Z'),
    });

    const inserted = smsRecipientCreateMany.mock.calls.map(
      ([arg]) => (arg as { data: unknown[] }).data,
    );
    expect(inserted.reduce((n, rows) => n + rows.length, 0)).toBe(AUDIENCE);
    expect(Math.max(...inserted.map((rows) => rows.length))).toBeLessThanOrEqual(SLICE);

    // Sliced: several lookups, none anywhere near the bind-parameter limit
    // (one slice of addresses plus the account keys).
    const lookups = suppressionQuery.mock.calls.map(([sql]) => bindCount(sql));
    expect(lookups.length).toBeGreaterThan(1);
    expect(Math.max(...lookups)).toBeLessThanOrEqual(SLICE + 10);

    const options = transactionOptions[0] as { timeout?: number } | undefined;
    expect(options?.timeout ?? 0).toBeGreaterThanOrEqual(60_000);
  });
});
