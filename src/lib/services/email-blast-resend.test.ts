import { beforeEach, describe, expect, it, vi } from 'vitest';

// The "Resend to non-engaged" toggle persisted into metadata.resend for a long
// while with NOTHING reading it back, so the follow-up never happened. These
// tests cover the two halves of the implementation that closed that gap:
//   scheduleResendIfDue        — queue the child when the parent finishes
//   materializeResendRecipients — fill its audience just before it sends
//
// Prisma is mocked; the logic under test is the decision-making.

const blastFindUnique = vi.fn();
const blastFindFirst = vi.fn();
const blastCreate = vi.fn();
const blastUpdate = vi.fn();
const recipientFindMany = vi.fn();
const recipientCount = vi.fn();
const recipientCreateMany = vi.fn();
const eventFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailBlast: {
      findUnique: (...a: unknown[]) => blastFindUnique(...a),
      findFirst: (...a: unknown[]) => blastFindFirst(...a),
      create: (...a: unknown[]) => blastCreate(...a),
      update: (...a: unknown[]) => blastUpdate(...a),
    },
    emailBlastRecipient: {
      findMany: (...a: unknown[]) => recipientFindMany(...a),
      count: (...a: unknown[]) => recipientCount(...a),
      createMany: (...a: unknown[]) => recipientCreateMany(...a),
    },
    emailEvent: { findMany: (...a: unknown[]) => eventFindMany(...a) },
    account: { findMany: vi.fn(async () => []) },
    contact: { findMany: vi.fn(async () => []) },
    emailSuppression: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('@/lib/crypto/encryption', () => ({
  decryptToken: (v: string) => v,
  encryptToken: (v: string) => v,
}));

const { materializeResendRecipients, scheduleResendIfDue } = await import(
  './email-blasts'
);

function parentBlast(overrides?: Record<string, unknown>) {
  return {
    id: 'parent-1',
    name: 'August Lease',
    subject: 'August lease offers',
    previewText: 'Big month',
    htmlContent: '<p>Body</p>',
    textContent: 'Body',
    sourceType: 'template-library',
    accountKeys: '["audi-layton"]',
    metadata: JSON.stringify({
      sourceType: 'template-library',
      resend: { enabled: true, delayHours: 48, subject: 'Still interested?' },
    }),
    sentCount: 10,
    createdByUserId: 'u1',
    createdByRole: 'admin',
    sourceAudienceId: null,
    sourceFilter: null,
    sourceListId: null,
    sourceContactIds: null,
    status: 'completed',
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of [
    blastFindUnique, blastFindFirst, blastCreate, blastUpdate,
    recipientFindMany, recipientCount, recipientCreateMany, eventFindMany,
  ]) fn.mockReset();
  blastFindFirst.mockResolvedValue(null);
  blastCreate.mockResolvedValue({ id: 'child-1' });
  blastUpdate.mockResolvedValue({});
  recipientCreateMany.mockResolvedValue({ count: 0 });
});

describe('scheduleResendIfDue', () => {
  it('queues a follow-up when the toggle is on', async () => {
    blastFindUnique.mockResolvedValue(parentBlast());
    await scheduleResendIfDue('parent-1');

    expect(blastCreate).toHaveBeenCalledTimes(1);
    const data = blastCreate.mock.calls[0][0].data;
    expect(data.status).toBe('scheduled');
    // The override wins over the parent's subject.
    expect(data.subject).toBe('Still interested?');
    expect(data.name).toContain('follow-up');
    expect(data.totalRecipients).toBe(0);
  });

  it('schedules it delayHours into the future', async () => {
    blastFindUnique.mockResolvedValue(parentBlast());
    const before = Date.now();
    await scheduleResendIfDue('parent-1');

    const when: Date = blastCreate.mock.calls[0][0].data.scheduledFor;
    const deltaHours = (when.getTime() - before) / 3_600_000;
    expect(deltaHours).toBeGreaterThan(47.9);
    expect(deltaHours).toBeLessThan(48.1);
  });

  it('falls back to the parent subject when no override is given', async () => {
    blastFindUnique.mockResolvedValue(
      parentBlast({
        metadata: JSON.stringify({
          resend: { enabled: true, delayHours: 72, subject: '  ' },
        }),
      }),
    );
    await scheduleResendIfDue('parent-1');
    expect(blastCreate.mock.calls[0][0].data.subject).toBe('August lease offers');
  });

  it('marks the child with resendOf so it is recognizable', async () => {
    blastFindUnique.mockResolvedValue(parentBlast());
    await scheduleResendIfDue('parent-1');
    const meta = JSON.parse(blastCreate.mock.calls[0][0].data.metadata);
    expect(meta.resendOf).toBe('parent-1');
    // Critically: the child must NOT itself carry an enabled resend, or
    // follow-ups would chain forever.
    expect(meta.resend).toBeUndefined();
  });

  it('does nothing when the toggle is off', async () => {
    blastFindUnique.mockResolvedValue(
      parentBlast({
        metadata: JSON.stringify({ resend: { enabled: false, delayHours: 72 } }),
      }),
    );
    await scheduleResendIfDue('parent-1');
    expect(blastCreate).not.toHaveBeenCalled();
  });

  it('does nothing when there is no metadata at all', async () => {
    blastFindUnique.mockResolvedValue(parentBlast({ metadata: null }));
    await scheduleResendIfDue('parent-1');
    expect(blastCreate).not.toHaveBeenCalled();
  });

  // A follow-up must never spawn a follow-up.
  it('does not chain off a blast that is itself a follow-up', async () => {
    blastFindUnique.mockResolvedValue(
      parentBlast({
        metadata: JSON.stringify({
          resendOf: 'grandparent',
          resend: { enabled: true, delayHours: 24 },
        }),
      }),
    );
    await scheduleResendIfDue('parent-1');
    expect(blastCreate).not.toHaveBeenCalled();
  });

  it('does nothing when the parent delivered nothing', async () => {
    blastFindUnique.mockResolvedValue(parentBlast({ sentCount: 0 }));
    await scheduleResendIfDue('parent-1');
    expect(blastCreate).not.toHaveBeenCalled();
  });

  // processEmailBlast can run more than once for one blast; a second pass must
  // not stack another follow-up.
  it('is idempotent when a follow-up already exists', async () => {
    blastFindUnique.mockResolvedValue(parentBlast());
    blastFindFirst.mockResolvedValue({ id: 'child-existing' });
    await scheduleResendIfDue('parent-1');
    expect(blastCreate).not.toHaveBeenCalled();
  });

  it('clamps an absurd delay into a sane window', async () => {
    blastFindUnique.mockResolvedValue(
      parentBlast({
        metadata: JSON.stringify({
          resend: { enabled: true, delayHours: 100000, subject: '' },
        }),
      }),
    );
    await scheduleResendIfDue('parent-1');
    const when: Date = blastCreate.mock.calls[0][0].data.scheduledFor;
    const deltaHours = (when.getTime() - Date.now()) / 3_600_000;
    expect(deltaHours).toBeLessThanOrEqual(720.1);
  });

  it('does nothing for a missing blast', async () => {
    blastFindUnique.mockResolvedValue(null);
    await scheduleResendIfDue('nope');
    expect(blastCreate).not.toHaveBeenCalled();
  });
});

describe('materializeResendRecipients', () => {
  const child = {
    id: 'child-1',
    status: 'scheduled',
    metadata: JSON.stringify({ sourceType: 'template-library', resendOf: 'parent-1' }),
  };

  it('is a no-op for a blast that is not a follow-up', async () => {
    blastFindUnique.mockResolvedValue({
      id: 'b1',
      status: 'queued',
      metadata: JSON.stringify({ sourceType: 'template-library' }),
    });
    await materializeResendRecipients('b1');
    expect(recipientCreateMany).not.toHaveBeenCalled();
  });

  it('is a no-op once recipients already exist', async () => {
    blastFindUnique.mockResolvedValue(child);
    recipientCount.mockResolvedValue(5);
    await materializeResendRecipients('child-1');
    expect(recipientCreateMany).not.toHaveBeenCalled();
  });

  it('targets exactly the recipients with no open or click', async () => {
    blastFindUnique.mockResolvedValue(child);
    recipientCount.mockResolvedValue(0);
    recipientFindMany.mockResolvedValue([
      { contactId: 'c1', accountKey: 'a', email: 'opened@x.com', fullName: 'A' },
      { contactId: 'c2', accountKey: 'a', email: 'quiet@x.com', fullName: 'B' },
      { contactId: 'c3', accountKey: 'a', email: 'clicked@x.com', fullName: 'C' },
    ]);
    eventFindMany.mockResolvedValue([
      { email: 'opened@x.com' },
      { email: 'clicked@x.com' },
    ]);

    await materializeResendRecipients('child-1');

    const rows = recipientCreateMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('quiet@x.com');
    expect(rows[0].status).toBe('pending');
    // Only open/click count as engagement — a delivery is not engagement.
    expect(eventFindMany.mock.calls[0][0].where.eventType.in.sort())
      .toEqual(['click', 'open']);
  });

  it('matches engagement case-insensitively', async () => {
    blastFindUnique.mockResolvedValue(child);
    recipientCount.mockResolvedValue(0);
    recipientFindMany.mockResolvedValue([
      { contactId: 'c1', accountKey: 'a', email: 'Dana@X.com', fullName: 'A' },
    ]);
    eventFindMany.mockResolvedValue([{ email: 'dana@x.com' }]);

    await materializeResendRecipients('child-1');
    expect(recipientCreateMany).not.toHaveBeenCalled();
    expect(blastUpdate.mock.calls[0][0].data.status).toBe('completed');
  });

  // Both of the next two would otherwise leave a follow-up with zero pending
  // recipients being re-swept every minute forever.
  it('closes itself out when everyone engaged', async () => {
    blastFindUnique.mockResolvedValue(child);
    recipientCount.mockResolvedValue(0);
    recipientFindMany.mockResolvedValue([
      { contactId: 'c1', accountKey: 'a', email: 'opened@x.com', fullName: 'A' },
    ]);
    eventFindMany.mockResolvedValue([{ email: 'opened@x.com' }]);

    await materializeResendRecipients('child-1');
    const data = blastUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('completed');
    expect(data.error).toContain('everyone opened');
  });

  it('closes itself out when the parent sent nothing', async () => {
    blastFindUnique.mockResolvedValue(child);
    recipientCount.mockResolvedValue(0);
    recipientFindMany.mockResolvedValue([]);

    await materializeResendRecipients('child-1');
    const data = blastUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('completed');
    expect(data.error).toContain('no successful sends');
  });

  it('records the audience size on the blast', async () => {
    blastFindUnique.mockResolvedValue(child);
    recipientCount.mockResolvedValue(0);
    recipientFindMany.mockResolvedValue([
      { contactId: 'c1', accountKey: 'a', email: 'a@x.com', fullName: null },
      { contactId: 'c2', accountKey: 'a', email: 'b@x.com', fullName: null },
    ]);
    eventFindMany.mockResolvedValue([]);

    await materializeResendRecipients('child-1');
    expect(blastUpdate.mock.calls[0][0].data.totalRecipients).toBe(2);
  });

  it('only ever reads SENT rows from the parent', async () => {
    blastFindUnique.mockResolvedValue(child);
    recipientCount.mockResolvedValue(0);
    recipientFindMany.mockResolvedValue([]);
    await materializeResendRecipients('child-1');
    expect(recipientFindMany.mock.calls[0][0].where).toEqual({
      campaignId: 'parent-1',
      status: 'sent',
    });
  });

  it('does not rebuild the audience of an already-finished follow-up', async () => {
    blastFindUnique.mockResolvedValue({ ...child, status: 'completed' });
    await materializeResendRecipients('child-1');
    expect(recipientCount).not.toHaveBeenCalled();
    expect(recipientCreateMany).not.toHaveBeenCalled();
  });
});
