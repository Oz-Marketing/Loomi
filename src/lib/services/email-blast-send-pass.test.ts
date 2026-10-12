import { beforeEach, describe, expect, it, vi } from 'vitest';

// How one send pass behaves — the guarantees that make a large blast safe to
// run unattended:
//
//   - a pass sends a bounded batch and leaves the rest pending for the next;
//   - an outage leaves recipients pending to retry, and trips a breaker
//     instead of failing the whole audience;
//   - a rejected API key pauses the blast without failing anyone;
//   - an ambiguous failure is never retried (no double sends);
//   - a bounce that lands before the "sent" write is not overwritten;
//   - a deleted contact is not mailed;
//   - a send-time preflight blocker pauses before anything is sent;
//   - one broken blast doesn't stop the sweep.
//
// Prisma, SendGrid and the gate are mocked; what's under test is control flow.

const blastFindUnique = vi.fn();
const blastFindUniqueOrThrow = vi.fn();
const blastUpdate = vi.fn();
const blastUpdateMany = vi.fn();
const blastFindMany = vi.fn();
const recipientFindMany = vi.fn();
const recipientUpdate = vi.fn();
const recipientUpdateMany = vi.fn();
const contactFindMany = vi.fn();
const sendEmail = vi.fn();
const preflight = vi.fn();

vi.mock('@/lib/prisma', () => {
  // The counters are recounted inside a transaction under a row lock
  // (recomputeEmailBlastCounters); the transaction runs against this same client.
  const prisma: Record<string, unknown> = {
    emailBlast: {
      findUnique: (...a: unknown[]) => blastFindUnique(...a),
      findUniqueOrThrow: (...a: unknown[]) => blastFindUniqueOrThrow(...a),
      findFirst: vi.fn(async () => null),
      findMany: (...a: unknown[]) => blastFindMany(...a),
      update: (...a: unknown[]) => blastUpdate(...a),
      updateMany: (...a: unknown[]) => blastUpdateMany(...a),
    },
    emailBlastRecipient: {
      findMany: (...a: unknown[]) => recipientFindMany(...a),
      update: (...a: unknown[]) => recipientUpdate(...a),
      updateMany: (...a: unknown[]) => recipientUpdateMany(...a),
      groupBy: vi.fn(async () => [{ status: 'pending', _count: { _all: 1 } }]),
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    account: {
      findMany: vi.fn(async () => [
        {
          key: 'young-chev',
          dealer: 'Young Chevrolet',
          senderEmail: 'offers@youngchevrolet.com',
          senderName: null,
          replyToEmail: null,
          sendgridApiKey: 'sg-key',
          address: '123 Main St',
          city: 'Layton',
          state: 'UT',
          postalCode: '84041',
        },
      ]),
    },
    contact: { findMany: (...a: unknown[]) => contactFindMany(...a) },
    emailEvent: { findMany: vi.fn(async () => []) },
    $queryRaw: vi.fn(async () => []),
  };
  prisma.$transaction = (fn: (tx: unknown) => unknown) => fn(prisma);
  return { prisma };
});

vi.mock('@/lib/crypto/encryption', () => ({
  decryptToken: (v: string) => v,
  encryptToken: (v: string) => v,
}));

vi.mock('@/lib/sending/sendgrid', async () => {
  class SendGridError extends Error {
    constructor(message: string, public readonly status: number) {
      super(message);
    }
  }
  return { sendEmailViaSendGrid: (...a: unknown[]) => sendEmail(...a), SendGridError };
});

vi.mock('@/lib/sending/warmup', () => ({
  getAllowances: vi.fn(async () => new Map()),
  getCombinedRemaining: vi.fn(async () => null),
  recordWarmupSends: vi.fn(async () => {}),
  releaseWarmupSends: vi.fn(async () => {}),
  sendingDomain: (email: string) => email.split('@')[1] ?? null,
}));

vi.mock('@/lib/sending/account-footer', () => ({
  resolveAccountFooters: vi.fn(async () => new Map()),
}));

vi.mock('@/lib/sending/blast-preflight', () => ({
  preflightEmailBlast: (...a: unknown[]) => preflight(...a),
  formatPreflightBlockers: () => 'The account has no mailing address.',
}));

vi.mock('@/lib/sending/suppression-lookup', () => ({
  loadEmailSuppressions: vi.fn(async () => () => null),
}));

vi.mock('@/lib/sending/mx-check', () => ({
  resolveDomainMx: vi.fn(async () => new Map()),
  domainOf: (email: string) => email.split('@')[1] ?? null,
}));

const { processEmailBlast, processDueEmailBlasts } = await import('./email-blasts');
const { SendGridError } = await import('@/lib/sending/sendgrid');

function blastRow(overrides?: Record<string, unknown>) {
  return {
    id: 'blast-1',
    name: 'Fall Service Offer',
    flowNodeKey: null,
    subject: 'Fall service',
    previewText: null,
    sourceType: 'template-library',
    status: 'scheduled',
    scheduledFor: null,
    startedAt: null,
    completedAt: null,
    totalRecipients: 30,
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
    createdAt: new Date('2026-10-12T12:00:00Z'),
    updatedAt: new Date('2026-10-12T12:00:00Z'),
    error: null,
    ...overrides,
  };
}

const recipients = (n: number, error: string | null = null) =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    email: `rider${i}@gmail.com`,
    fullName: `Rider ${i}`,
    accountKey: 'young-chev',
    contactId: `c${i}`,
    error,
  }));

function wire(batch: ReturnType<typeof recipients>) {
  blastFindUnique.mockImplementation(async (args: Record<string, unknown>) => {
    const select = (args.select ?? {}) as Record<string, boolean>;
    if (select.status && Object.keys(select).length === 1) return { status: 'processing' };
    return blastRow();
  });
  recipientFindMany.mockImplementation(async (args: Record<string, unknown>) => {
    if (args.distinct) return [{ accountKey: 'young-chev' }];
    const take = (args.take as number | undefined) ?? batch.length;
    return batch.slice(0, take);
  });
  contactFindMany.mockImplementation(async () =>
    batch.map((r) => ({ id: r.contactId, accountKey: 'young-chev', dnd: null })),
  );
}

/** The `data` of every recipient write aimed at one row. */
function writesFor(id: string) {
  return recipientUpdateMany.mock.calls
    .map(([args]) => args as { where: { id?: string }; data: Record<string, unknown> })
    .filter((args) => args.where.id === id)
    .map((args) => args.data);
}

/** The blast-level error written by the end-of-pass update, if any. */
function finalBlastError(): unknown {
  const writes = blastUpdateMany.mock.calls
    .map(([args]) => args as { data: Record<string, unknown> })
    .filter((args) => 'error' in args.data);
  return writes.at(-1)?.data.error;
}

beforeEach(() => {
  for (const fn of [
    blastFindUnique, blastFindUniqueOrThrow, blastUpdate, blastUpdateMany, blastFindMany,
    recipientFindMany, recipientUpdate, recipientUpdateMany, contactFindMany, sendEmail, preflight,
  ]) fn.mockReset();
  blastUpdateMany.mockResolvedValue({ count: 1 });
  blastFindUniqueOrThrow.mockResolvedValue(blastRow({ status: 'processing' }));
  blastUpdate.mockResolvedValue(blastRow());
  recipientUpdate.mockResolvedValue({});
  recipientUpdateMany.mockResolvedValue({ count: 1 });
  sendEmail.mockResolvedValue({ messageId: 'sg-1' });
  preflight.mockResolvedValue({ ok: true, issues: [] });
});

describe('a send pass', () => {
  it('sends at most one batch and leaves the rest pending', async () => {
    wire(recipients(30));
    await processEmailBlast('blast-1', { concurrency: 1, batchSize: 10 });
    expect(sendEmail).toHaveBeenCalledTimes(10);
    const batchQuery = recipientFindMany.mock.calls.find(([a]) => (a as { take?: number }).take);
    expect((batchQuery?.[0] as { take: number }).take).toBe(10);
  });

  it('leaves a recipient pending to retry when SendGrid answers 503', async () => {
    wire(recipients(1));
    sendEmail.mockRejectedValue(new SendGridError('Service Unavailable', 503));
    await processEmailBlast('blast-1', { concurrency: 1 });
    const [data] = writesFor('r0');
    expect(data.status).toBeUndefined(); // still pending
    expect(String(data.error)).toMatch(/^Temporary failure \(attempt 1 of 5\)/);
  });

  it('gives up after the last attempt', async () => {
    wire(recipients(1, 'Temporary failure (attempt 4 of 5): SendGrid: 503'));
    sendEmail.mockRejectedValue(new SendGridError('Service Unavailable', 503));
    await processEmailBlast('blast-1', { concurrency: 1 });
    expect(writesFor('r0')[0].status).toBe('failed');
  });

  it('trips the breaker in an outage instead of failing the whole audience', async () => {
    wire(recipients(40));
    sendEmail.mockRejectedValue(new SendGridError('Service Unavailable', 503));
    await processEmailBlast('blast-1', { concurrency: 1 });
    // Stops at the threshold — the other 30 are never attempted.
    expect(sendEmail).toHaveBeenCalledTimes(10);
    expect(String(finalBlastError())).toMatch(/^Paused: SendGrid stopped accepting mail/);
  });

  it('pauses on a rejected API key without failing anyone', async () => {
    wire(recipients(5));
    sendEmail.mockRejectedValue(new SendGridError('Unauthorized', 401));
    await processEmailBlast('blast-1', { concurrency: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(recipientUpdateMany).not.toHaveBeenCalled();
    expect(String(finalBlastError())).toMatch(/API key/);
  });

  it('never retries an ambiguous failure', async () => {
    wire(recipients(1));
    sendEmail.mockRejectedValue(new SendGridError('SendGrid request timed out', 0));
    await processEmailBlast('blast-1', { concurrency: 1 });
    const [data] = writesFor('r0');
    expect(data.status).toBe('failed');
    expect(String(data.error)).toMatch(/not retried/);
  });

  it('records a send without overwriting a bounce that got there first', async () => {
    wire(recipients(1));
    await processEmailBlast('blast-1', { concurrency: 1 });
    const sentWrite = recipientUpdateMany.mock.calls
      .map(([a]) => a as { where: Record<string, unknown>; data: Record<string, unknown> })
      .find((a) => a.data.status === 'sent');
    expect(sentWrite?.where).toEqual({ id: 'r0', status: { not: 'bounced' } });
  });

  it('does not mail a contact that was deleted after scheduling', async () => {
    wire(recipients(2));
    contactFindMany.mockImplementation(async () => [
      { id: 'c0', accountKey: 'young-chev', dnd: null },
    ]);
    await processEmailBlast('blast-1', { concurrency: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(writesFor('r1')[0]).toMatchObject({ status: 'skipped' });
  });

  it('sanitizes the display names SendGrid would reject', async () => {
    wire([{ ...recipients(1)[0], fullName: 'Smith, John' }]);
    await processEmailBlast('blast-1', { concurrency: 1 });
    const payload = sendEmail.mock.calls[0][0] as {
      to: { name?: string };
      from: { name?: string };
    };
    expect(payload.to.name).toBe('Smith John');
    // No sender name configured: falls back to the account's name.
    expect(payload.from.name).toBe('Young Chevrolet');
  });

  it('pauses before sending anything when the send-time gate blocks', async () => {
    wire(recipients(5));
    preflight.mockResolvedValue({
      ok: false,
      issues: [{ severity: 'blocker', code: 'x', accountKey: 'young-chev', message: 'm', remedy: 'r' }],
    });
    await processEmailBlast('blast-1', { concurrency: 1 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(String(finalBlastError())).toMatch(/^Paused: /);
  });
});

describe('a sweep', () => {
  it('rotates by least-recently-progressed and survives a broken blast', async () => {
    const due = [
      { id: 'broken', accountKeys: '["young-chev"]' },
      { id: 'healthy', accountKeys: '["young-chev"]' },
    ];
    // Honor the sweep's "sitting out" filter, as the database would.
    blastFindMany.mockImplementation(async (args: { where: { id?: { notIn?: string[] } } }) =>
      due.filter((row) => !args.where.id?.notIn?.includes(row.id)),
    );
    wire(recipients(1));
    // The healthy blast's one recipient is sent on its first pass; after that
    // it has nothing pending.
    let batches = 0;
    recipientFindMany.mockImplementation(async (args: Record<string, unknown>) => {
      if (args.distinct) return batches > 0 ? [] : [{ accountKey: 'young-chev' }];
      batches += 1;
      return recipients(1);
    });
    blastFindUnique.mockImplementation(async (args: Record<string, unknown>) => {
      const where = args.where as { id: string };
      if (where.id === 'broken') throw new Error('boom');
      const select = (args.select ?? {}) as Record<string, boolean>;
      if (select.status && Object.keys(select).length === 1) return { status: 'processing' };
      return blastRow({ id: where.id });
    });

    await processDueEmailBlasts({ concurrency: 1, timeBudgetMs: 5_000 });

    const query = blastFindMany.mock.calls[0][0] as { orderBy: unknown };
    expect(query.orderBy).toEqual([{ updatedAt: 'asc' }, { createdAt: 'asc' }]);
    // The broken blast threw; the healthy one still sent — once, then the
    // sweep ended because nothing was left to make progress on.
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('a sweep with only temporary failures left', () => {
  it('does not hammer the same recipients again within the tick', async () => {
    blastFindMany.mockImplementation(async (args: { where: { id?: { notIn?: string[] } } }) =>
      [{ id: 'blast-1', accountKeys: '["young-chev"]' }].filter(
        (row) => !args.where.id?.notIn?.includes(row.id),
      ),
    );
    wire(recipients(2));
    sendEmail.mockRejectedValue(new SendGridError('Service Unavailable', 503));

    await processDueEmailBlasts({ concurrency: 1, timeBudgetMs: 5_000 });

    // One attempt each this tick; the next attempt waits for a later tick.
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});
