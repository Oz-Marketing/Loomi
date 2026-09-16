import { beforeEach, describe, expect, it, vi } from 'vitest';

// The part of cancellation that is easy to get wrong and impossible to see
// from the outside: stopping a send that is ALREADY RUNNING.
//
// processEmailBlast loads its pending recipients once and then works through
// them, so a 10k-recipient blast lives for minutes. Writing 'canceled' to the
// row does nothing to that loop on its own — it is holding its list in memory.
// Two things therefore have to hold:
//
//   1. the loop polls the row's status between sends and stops dispatching;
//   2. its final write, which derives status from recipient counts, does not
//      overwrite the cancel with 'completed'.
//
// Prisma and SendGrid are mocked; what's under test is the control flow.

const blastFindUnique = vi.fn();
const blastFindUniqueOrThrow = vi.fn();
const blastUpdate = vi.fn();
const blastUpdateMany = vi.fn();
const blastFindFirst = vi.fn();
const recipientFindMany = vi.fn();
const recipientUpdate = vi.fn();
const sendEmail = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailBlast: {
      findUnique: (...a: unknown[]) => blastFindUnique(...a),
      findUniqueOrThrow: (...a: unknown[]) => blastFindUniqueOrThrow(...a),
      findFirst: (...a: unknown[]) => blastFindFirst(...a),
      update: (...a: unknown[]) => blastUpdate(...a),
      updateMany: (...a: unknown[]) => blastUpdateMany(...a),
    },
    emailBlastRecipient: {
      findMany: (...a: unknown[]) => recipientFindMany(...a),
      update: (...a: unknown[]) => recipientUpdate(...a),
      count: vi.fn(async () => 0),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    account: {
      findMany: vi.fn(async () => [
        {
          key: 'young-chev',
          dealer: 'Young Chevrolet',
          senderEmail: 'offers@youngchevrolet.com',
          senderName: 'Young Chevrolet',
          replyToEmail: null,
          sendgridApiKey: 'sg-key',
          address: '123 Main St',
          city: 'Layton',
          state: 'UT',
          postalCode: '84041',
        },
      ]),
    },
    contact: { findMany: vi.fn(async () => []) },
    emailSuppression: { findMany: vi.fn(async () => []) },
    emailEvent: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('@/lib/crypto/encryption', () => ({
  decryptToken: (v: string) => v,
  encryptToken: (v: string) => v,
}));

vi.mock('@/lib/sending/sendgrid', () => ({
  sendEmailViaSendGrid: (...a: unknown[]) => sendEmail(...a),
  SendGridError: class SendGridError extends Error {},
}));

// No warm-up cap — this test is about cancellation, not the daily budget.
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

const { processEmailBlast } = await import('./email-blasts');
const { CANCEL_GATE_MAX_CALLS } = await import('@/lib/sending/blast-cancellation');

// Deliberately larger than CANCEL_GATE_MAX_CALLS so the gate's re-check
// actually fires inside one run — a fixture smaller than the bound would pass
// whether or not the loop ever asks again.
const RECIPIENTS = Array.from({ length: 60 }, (_, i) => ({
  id: `r${i}`,
  email: `person${i}@gmail.com`,
  fullName: `Person ${i}`,
  accountKey: 'young-chev',
  contactId: `c${i}`,
}));

function blastRow(overrides?: Record<string, unknown>) {
  return {
    id: 'blast-1',
    name: 'Labor Day Event',
    flowNodeKey: null,
    subject: 'Labor Day',
    previewText: null,
    sourceType: 'template-library',
    status: 'scheduled',
    scheduledFor: new Date('2026-09-16T12:00:00Z'),
    startedAt: null,
    completedAt: null,
    totalRecipients: 60,
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

/**
 * Route the several distinct findUnique calls processEmailBlast makes:
 * the main load (which asks for `recipients`), the resend check, and the
 * cancel gate's status poll.
 */
function wireFindUnique(status: () => string) {
  blastFindUnique.mockImplementation(async (args: Record<string, unknown>) => {
    if (args.include) {
      return { ...blastRow({ status: status() }), recipients: RECIPIENTS };
    }
    const select = (args.select ?? {}) as Record<string, boolean>;
    if (select.status && Object.keys(select).length === 1) {
      return { status: status() };
    }
    return blastRow({ status: status() });
  });
}

beforeEach(() => {
  for (const fn of [
    blastFindUnique, blastFindUniqueOrThrow, blastUpdate, blastUpdateMany,
    blastFindFirst, recipientFindMany, recipientUpdate, sendEmail,
  ]) fn.mockReset();

  blastUpdateMany.mockResolvedValue({ count: 1 });
  blastUpdate.mockResolvedValue(blastRow());
  blastFindFirst.mockResolvedValue(null);
  recipientUpdate.mockResolvedValue({});
  recipientFindMany.mockResolvedValue([]);
  sendEmail.mockResolvedValue({ messageId: 'sg-1' });
  blastFindUniqueOrThrow.mockImplementation(async () =>
    blastRow({ status: 'canceled' }),
  );
});

describe('processEmailBlast — cancellation mid-send', () => {
  it('stops dispatching once the row flips to canceled', async () => {
    let status = 'scheduled';
    wireFindUnique(() => status);

    // Flip to canceled after the third message goes out, the way a click
    // would land partway through the audience.
    sendEmail.mockImplementation(async () => {
      if (sendEmail.mock.calls.length >= 3) status = 'canceled';
      return { messageId: 'sg-1' };
    });

    await processEmailBlast('blast-1', { concurrency: 1 });

    // Without the gate this would be all 60. The bound is CANCEL_GATE_MAX_CALLS
    // messages past the cancel, plus whatever was already in flight — the point
    // is that the overshoot is small and bounded, not that it is zero. Mail
    // already handed to SendGrid cannot be recalled.
    expect(sendEmail.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(sendEmail.mock.calls.length).toBeLessThanOrEqual(
      3 + CANCEL_GATE_MAX_CALLS,
    );
    expect(sendEmail.mock.calls.length).toBeLessThan(RECIPIENTS.length);
  });

  it('does not overwrite canceled with a resolved status at the end', async () => {
    let status = 'scheduled';
    wireFindUnique(() => status);
    sendEmail.mockImplementation(async () => {
      status = 'canceled';
      return { messageId: 'sg-1' };
    });

    await processEmailBlast('blast-1', { concurrency: 1 });

    // Every status write after the claim goes through updateUnlessCanceled,
    // which carries the `status: { not: 'canceled' }` guard. A bare
    // emailBlast.update would resolve the blast to 'completed' — zero pending
    // recipients reads as "finished" to resolveBlastStatus.
    const guardedWrites = blastUpdateMany.mock.calls.filter(
      (call) => call[0]?.where?.status?.not === 'canceled',
    );
    expect(guardedWrites.length).toBeGreaterThan(0);
    expect(blastUpdate).not.toHaveBeenCalled();
  });

  it('schedules no follow-up for a canceled blast', async () => {
    let status = 'scheduled';
    wireFindUnique(() => status);
    sendEmail.mockImplementation(async () => {
      status = 'canceled';
      return { messageId: 'sg-1' };
    });

    await processEmailBlast('blast-1', { concurrency: 1 });

    // scheduleResendIfDue looks only at sentCount, and cancelling halfway
    // leaves real deliveries behind — so without the guard, stopping a blast
    // would quietly queue a second one.
    expect(blastFindFirst).not.toHaveBeenCalled();
  });

  it('bails out when the cancel lands before the blast is claimed', async () => {
    wireFindUnique(() => 'scheduled');
    // The guarded claim matches nothing: the row went terminal between the
    // read and the write.
    blastUpdateMany.mockResolvedValue({ count: 0 });

    const result = await processEmailBlast('blast-1', { concurrency: 1 });

    expect(result.status).toBe('canceled');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('returns immediately when the blast is already canceled', async () => {
    wireFindUnique(() => 'canceled');

    const result = await processEmailBlast('blast-1', { concurrency: 1 });

    expect(result.status).toBe('canceled');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(blastUpdateMany).not.toHaveBeenCalled();
  });
});
