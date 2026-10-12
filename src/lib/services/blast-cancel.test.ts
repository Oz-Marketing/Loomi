import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cancelling a blast has to do three things at once, and each of them had a
// way to silently fail:
//   - leave PROCESSABLE_STATUSES, or the worker sweep just resumes the send;
//   - resolve every pending recipient, or the counts describe a send that
//     never happened;
//   - survive the end of an in-flight processEmailBlast, whose final write
//     derives status from recipient counts and would otherwise resolve a
//     canceled blast to 'completed'.
//
// Prisma is mocked; the logic under test is the state machine.

const emailFindUnique = vi.fn();
const emailFindUniqueOrThrow = vi.fn();
const emailUpdate = vi.fn();
const emailUpdateMany = vi.fn();
const emailRecipientFindMany = vi.fn();
const emailRecipientUpdateMany = vi.fn();

const smsFindUnique = vi.fn();
const smsFindUniqueOrThrow = vi.fn();
const smsUpdate = vi.fn();
const smsRecipientFindMany = vi.fn();
const smsRecipientUpdateMany = vi.fn();

const emailCounterWrite = vi.fn();

const txClient = {
  // The row lock recomputeEmailBlastCounters takes before recounting.
  $queryRaw: vi.fn(async () => []),
  emailBlast: {
    update: (...a: unknown[]) => emailUpdate(...a),
    updateMany: (...a: unknown[]) => emailCounterWrite(...a),
  },
  emailBlastRecipient: {
    updateMany: (...a: unknown[]) => emailRecipientUpdateMany(...a),
    groupBy: async (...a: unknown[]) => groupByStatus(await emailRecipientFindMany(...a)),
  },
  smsBlast: { update: (...a: unknown[]) => smsUpdate(...a) },
  smsBlastRecipient: {
    updateMany: (...a: unknown[]) => smsRecipientUpdateMany(...a),
  },
};

/**
 * The services count recipients with one grouped query; the fixtures below
 * describe recipients as rows. Derive the grouped answer from those rows so
 * each test keeps saying what the recipients look like, not how they're
 * counted.
 */
function groupByStatus(rows: { status: string }[] | undefined) {
  const counts = new Map<string, number>();
  for (const row of rows ?? []) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  return [...counts].map(([status, n]) => ({ status, _count: { _all: n } }));
}
function firstFailure(rows: { status: string; error?: string | null }[] | undefined) {
  return (rows ?? []).find((r) => r.status === 'failed' && r.error) ?? null;
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient),
    emailBlast: {
      findUnique: (...a: unknown[]) => emailFindUnique(...a),
      findUniqueOrThrow: (...a: unknown[]) => emailFindUniqueOrThrow(...a),
      update: (...a: unknown[]) => emailUpdate(...a),
      updateMany: (...a: unknown[]) => emailUpdateMany(...a),
    },
    emailBlastRecipient: {
      findMany: (...a: unknown[]) => emailRecipientFindMany(...a),
      updateMany: (...a: unknown[]) => emailRecipientUpdateMany(...a),
      groupBy: async (...a: unknown[]) => groupByStatus(await emailRecipientFindMany(...a)),
      findFirst: async (...a: unknown[]) => firstFailure(await emailRecipientFindMany(...a)),
    },
    smsBlast: {
      findUnique: (...a: unknown[]) => smsFindUnique(...a),
      findUniqueOrThrow: (...a: unknown[]) => smsFindUniqueOrThrow(...a),
      update: (...a: unknown[]) => smsUpdate(...a),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    smsBlastRecipient: {
      findMany: (...a: unknown[]) => smsRecipientFindMany(...a),
      updateMany: (...a: unknown[]) => smsRecipientUpdateMany(...a),
      groupBy: async (...a: unknown[]) => groupByStatus(await smsRecipientFindMany(...a)),
      findFirst: async (...a: unknown[]) => firstFailure(await smsRecipientFindMany(...a)),
    },
  },
}));

vi.mock('@/lib/crypto/encryption', () => ({
  decryptToken: (v: string) => v,
  encryptToken: (v: string) => v,
}));

const { cancelEmailBlast } = await import('./email-blasts');
const { cancelSmsBlast } = await import('./sms-blasts');

/** Minimal row shaped for toSummary(). */
function summaryRow(overrides?: Record<string, unknown>) {
  return {
    id: 'blast-1',
    name: 'Labor Day Event',
    flowNodeKey: null,
    subject: 'Labor Day',
    previewText: null,
    sourceType: 'template-library',
    message: 'Labor Day',
    status: 'canceled',
    scheduledFor: new Date('2026-09-20T15:00:00Z'),
    startedAt: null,
    completedAt: new Date('2026-09-16T12:00:00Z'),
    totalRecipients: 500,
    sentCount: 0,
    failedCount: 0,
    accountKeys: '["young-chev"]',
    sourceAudienceId: null,
    sourceFilter: null,
    sourceListId: null,
    sourceContactIds: null,
    htmlContent: '<p>Body</p>',
    textContent: null,
    metadata: null,
    createdAt: new Date('2026-09-15T12:00:00Z'),
    updatedAt: new Date('2026-09-16T12:00:00Z'),
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of [
    emailCounterWrite,
    emailFindUnique, emailFindUniqueOrThrow, emailUpdate, emailUpdateMany,
    emailRecipientFindMany, emailRecipientUpdateMany,
    smsFindUnique, smsFindUniqueOrThrow, smsUpdate,
    smsRecipientFindMany, smsRecipientUpdateMany,
  ]) fn.mockReset();
  emailUpdate.mockResolvedValue(summaryRow());
  emailCounterWrite.mockResolvedValue({ count: 1 });
  emailFindUniqueOrThrow.mockResolvedValue(summaryRow());
  smsUpdate.mockResolvedValue(summaryRow());
  emailRecipientUpdateMany.mockResolvedValue({ count: 0 });
  smsRecipientUpdateMany.mockResolvedValue({ count: 0 });
  emailRecipientFindMany.mockResolvedValue([]);
  smsRecipientFindMany.mockResolvedValue([]);
});

describe('cancelEmailBlast', () => {
  it('moves a scheduled blast to canceled and resolves its pending recipients', async () => {
    emailFindUnique.mockResolvedValue({ id: 'blast-1', status: 'scheduled' });

    await cancelEmailBlast('blast-1');

    // Pending → skipped, so summarizeCampaign stops counting them as work
    // still to do and the sweep has nothing left to pick up.
    const recipientWrite = emailRecipientUpdateMany.mock.calls[0][0];
    expect(recipientWrite.where).toEqual({
      campaignId: 'blast-1',
      status: 'pending',
    });
    expect(recipientWrite.data.status).toBe('skipped');
    expect(recipientWrite.data.error).toBe('Canceled before send');

    const statusWrite = emailUpdate.mock.calls[0][0];
    expect(statusWrite.data.status).toBe('canceled');
    expect(statusWrite.data.completedAt).toBeInstanceOf(Date);
  });

  it('cancels a blast that is already mid-send', async () => {
    emailFindUnique.mockResolvedValue({ id: 'blast-1', status: 'processing' });
    await expect(cancelEmailBlast('blast-1')).resolves.toBeDefined();
    expect(emailUpdate.mock.calls[0][0].data.status).toBe('canceled');
  });

  it('reports counts from the recipients as they actually stand', async () => {
    emailFindUnique.mockResolvedValue({ id: 'blast-1', status: 'processing' });
    // Halfway through a 5-recipient send when the cancel landed.
    emailRecipientFindMany.mockResolvedValue([
      { status: 'sent', error: null },
      { status: 'sent', error: null },
      { status: 'failed', error: 'SendGrid: 550' },
      { status: 'skipped', error: 'Canceled before send' },
      { status: 'skipped', error: 'Canceled before send' },
    ]);

    await cancelEmailBlast('blast-1');

    // The counters are recounted from the rows, under the blast's row lock.
    // Mail that left is still counted as sent — cancelling does not un-send it.
    const countsWrite = emailCounterWrite.mock.calls.at(-1)?.[0];
    expect(countsWrite.data).toMatchObject({
      sentCount: 2,
      failedCount: 1,
      bouncedCount: 0,
    });
  });

  it('refuses a blast that already finished', async () => {
    emailFindUnique.mockResolvedValue({ id: 'blast-1', status: 'completed' });
    await expect(cancelEmailBlast('blast-1')).rejects.toThrow(
      /already finished sending/,
    );
    expect(emailUpdate).not.toHaveBeenCalled();
  });

  it('points a draft at Delete instead', async () => {
    emailFindUnique.mockResolvedValue({ id: 'blast-1', status: 'draft' });
    await expect(cancelEmailBlast('blast-1')).rejects.toThrow(/still a draft/);
    expect(emailUpdate).not.toHaveBeenCalled();
  });

  it('is idempotent — a double-click is not an error', async () => {
    emailFindUnique.mockResolvedValue({ id: 'blast-1', status: 'canceled' });
    emailFindUniqueOrThrow.mockResolvedValue(summaryRow());

    const result = await cancelEmailBlast('blast-1');

    expect(result.status).toBe('canceled');
    expect(emailUpdate).not.toHaveBeenCalled();
    expect(emailRecipientUpdateMany).not.toHaveBeenCalled();
  });

  it('404s an unknown id', async () => {
    emailFindUnique.mockResolvedValue(null);
    await expect(cancelEmailBlast('nope')).rejects.toThrow('Campaign not found');
  });
});

describe('cancelSmsBlast', () => {
  it('moves a scheduled blast to canceled and resolves its pending recipients', async () => {
    smsFindUnique.mockResolvedValue({ id: 'blast-1', status: 'scheduled' });

    await cancelSmsBlast('blast-1');

    const recipientWrite = smsRecipientUpdateMany.mock.calls[0][0];
    expect(recipientWrite.where).toEqual({
      campaignId: 'blast-1',
      status: 'pending',
    });
    expect(recipientWrite.data.status).toBe('skipped');
    expect(smsUpdate.mock.calls[0][0].data.status).toBe('canceled');
  });

  it('releases texts parked on a quiet-hours hold', async () => {
    // A held recipient sits `pending` with a "holding until 8am local" note,
    // sometimes overnight. Cancelling has to reach those rows too, or the
    // blast goes out the next morning after being called back.
    smsFindUnique.mockResolvedValue({ id: 'blast-1', status: 'processing' });
    smsRecipientFindMany.mockResolvedValue([
      { status: 'skipped', error: 'Canceled before send' },
      { status: 'skipped', error: 'Canceled before send' },
    ]);

    await cancelSmsBlast('blast-1');

    expect(smsRecipientUpdateMany.mock.calls[0][0].where.status).toBe('pending');
    expect(smsUpdate.mock.calls[1][0].data).toMatchObject({
      totalRecipients: 2,
      sentCount: 0,
    });
  });

  it('refuses a blast that already finished', async () => {
    smsFindUnique.mockResolvedValue({ id: 'blast-1', status: 'partial' });
    await expect(cancelSmsBlast('blast-1')).rejects.toThrow(
      /already finished sending/,
    );
    expect(smsUpdate).not.toHaveBeenCalled();
  });
});
