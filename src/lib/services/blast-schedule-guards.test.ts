import { beforeEach, describe, expect, it, vi } from 'vitest';

// The guarantees the schedule path makes, each of which used to be missing:
//
//  - Only a DRAFT can be scheduled. Scheduling replaces a blast's recipient
//    rows, so re-running it on a blast that was already sending deleted the
//    rows marked `sent`, recreated them as `pending`, and the worker mailed
//    everyone again. A double-clicked Schedule button or a retry after a
//    half-failed multi-channel schedule was enough.
//  - A multi-channel pair commits in ONE transaction, so it can't end up with
//    one half scheduled and the other still a draft.
//  - Two contacts sharing a phone get one text.
//  - An unreadable send time is refused, never read as "send now".
//
// Prisma is mocked; what's under test is the order and shape of the writes.

const writes: string[] = [];
let emailClaimCount = 1;
let smsClaimCount = 1;
const emailCreateMany = vi.fn();
const smsCreateMany = vi.fn();
let transactions = 0;

function row(overrides?: Record<string, unknown>) {
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
    totalRecipients: 2,
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
    ...overrides,
  };
}

const txClient = {
  emailBlast: {
    updateMany: vi.fn(async () => {
      writes.push('email.claim');
      return { count: emailClaimCount };
    }),
    update: vi.fn(async () => {
      writes.push('email.update');
      return row();
    }),
  },
  emailBlastRecipient: {
    deleteMany: vi.fn(async () => {
      writes.push('email.deleteRecipients');
      return { count: 0 };
    }),
    createMany: (...a: unknown[]) => {
      writes.push('email.createRecipients');
      return emailCreateMany(...a);
    },
  },
  smsBlast: {
    updateMany: vi.fn(async () => {
      writes.push('sms.claim');
      return { count: smsClaimCount };
    }),
    update: vi.fn(async () => {
      writes.push('sms.update');
      return row();
    }),
  },
  smsBlastRecipient: {
    deleteMany: vi.fn(async () => {
      writes.push('sms.deleteRecipients');
      return { count: 0 };
    }),
    createMany: (...a: unknown[]) => {
      writes.push('sms.createRecipients');
      return smsCreateMany(...a);
    },
  },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: async (fn: (tx: typeof txClient) => Promise<unknown>) => {
      transactions += 1;
      return fn(txClient);
    },
    // Opt-out lookup (raw SQL) and the account hierarchy behind it.
    $queryRaw: vi.fn(async () => []),
    account: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('@/lib/crypto/encryption', () => ({
  decryptToken: (v: string) => v,
  encryptToken: (v: string) => v,
}));

const {
  BlastNotDraftError,
  planEmailBlastSchedule,
  scheduleEmailBlastDraft,
} = await import('./email-blasts');
const { planSmsBlastSchedule, scheduleSmsBlastDraft } = await import('./sms-blasts');
const { parseSendTime, scheduleLinkedBlastDrafts } = await import('./blast-schedule');

const LATER = new Date('2027-01-05T15:00:00Z');
const emailRecipients = [
  { contactId: 'c1', accountKey: 'young-powersports', email: 'rider1@gmail.com', fullName: 'Rider One' },
  { contactId: 'c2', accountKey: 'young-powersports', email: 'rider2@gmail.com', fullName: 'Rider Two' },
];
const smsRecipients = [
  { contactId: 'c1', accountKey: 'young-powersports', phone: '+18015550101', fullName: 'Rider One' },
  { contactId: 'c2', accountKey: 'young-powersports', phone: '+18015550102', fullName: 'Rider Two' },
];

beforeEach(() => {
  writes.length = 0;
  transactions = 0;
  emailClaimCount = 1;
  smsClaimCount = 1;
  emailCreateMany.mockReset().mockResolvedValue({ count: 0 });
  smsCreateMany.mockReset().mockResolvedValue({ count: 0 });
});

describe('only a draft can be scheduled', () => {
  it('claims the draft before touching any recipient row', async () => {
    await scheduleEmailBlastDraft('blast-1', { recipients: emailRecipients, scheduledFor: LATER });
    expect(writes).toEqual([
      'email.claim',
      'email.deleteRecipients',
      'email.createRecipients',
      'email.update',
    ]);
    const claim = txClient.emailBlast.updateMany.mock.calls.at(-1) as unknown as [
      { where: Record<string, unknown> },
    ];
    expect(claim[0].where).toEqual({ id: 'blast-1', status: 'draft' });
  });

  it('refuses an email blast that is no longer a draft, without deleting its recipients', async () => {
    emailClaimCount = 0; // already queued / sending / sent
    await expect(
      scheduleEmailBlastDraft('blast-1', { recipients: emailRecipients, scheduledFor: LATER }),
    ).rejects.toBeInstanceOf(BlastNotDraftError);
    expect(writes).toEqual(['email.claim']);
  });

  it('refuses an SMS blast that is no longer a draft, without deleting its recipients', async () => {
    smsClaimCount = 0;
    await expect(
      scheduleSmsBlastDraft('blast-1', { recipients: smsRecipients, scheduledFor: LATER }),
    ).rejects.toBeInstanceOf(BlastNotDraftError);
    expect(writes).toEqual(['sms.claim']);
  });
});

describe('multi-channel pairs commit together', () => {
  it('writes both halves inside a single transaction', async () => {
    const [emailPlan, smsPlan] = await Promise.all([
      planEmailBlastSchedule('email-1', { recipients: emailRecipients, scheduledFor: LATER }),
      planSmsBlastSchedule('sms-1', { recipients: smsRecipients, scheduledFor: LATER }),
    ]);
    await scheduleLinkedBlastDrafts(emailPlan, smsPlan);
    expect(transactions).toBe(1);
    expect(writes).toEqual([
      'email.claim',
      'email.deleteRecipients',
      'email.createRecipients',
      'email.update',
      'sms.claim',
      'sms.deleteRecipients',
      'sms.createRecipients',
      'sms.update',
    ]);
  });

  it('fails the whole pair when the text half is no longer a draft', async () => {
    smsClaimCount = 0;
    const [emailPlan, smsPlan] = await Promise.all([
      planEmailBlastSchedule('email-1', { recipients: emailRecipients, scheduledFor: LATER }),
      planSmsBlastSchedule('sms-1', { recipients: smsRecipients, scheduledFor: LATER }),
    ]);
    // Thrown inside the one transaction, so Postgres rolls the email half
    // back with it.
    await expect(scheduleLinkedBlastDrafts(emailPlan, smsPlan)).rejects.toBeInstanceOf(
      BlastNotDraftError,
    );
    expect(transactions).toBe(1);
  });
});

describe('SMS recipients', () => {
  it('sends one text to a phone shared by two contacts', async () => {
    const plan = await planSmsBlastSchedule('sms-1', {
      recipients: [
        { contactId: 'mom', accountKey: 'young-powersports', phone: '(801) 555-0101', fullName: 'Pat' },
        { contactId: 'kid', accountKey: 'young-powersports', phone: '+1 801 555 0101', fullName: 'Sam' },
      ],
      scheduledFor: LATER,
    });
    expect(plan.rows).toHaveLength(1);
    expect(plan.totalRecipients).toBe(1);
  });
});

describe('send time', () => {
  it('reads an absent time as "send now"', () => {
    expect(parseSendTime(undefined)).toEqual({ ok: true, scheduledFor: null });
    expect(parseSendTime(null)).toEqual({ ok: true, scheduledFor: null });
    expect(parseSendTime('')).toEqual({ ok: true, scheduledFor: null });
  });

  it('reads a valid ISO time', () => {
    const parsed = parseSendTime('2027-01-05T15:00:00.000Z');
    expect(parsed.ok && parsed.scheduledFor?.toISOString()).toBe('2027-01-05T15:00:00.000Z');
  });

  it('refuses an unreadable time instead of sending immediately', () => {
    expect(parseSendTime('next tuesday-ish').ok).toBe(false);
    expect(parseSendTime(1234).ok).toBe(false);
  });
});
