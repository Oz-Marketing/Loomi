import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SendGrid delivers its Event Webhook at least once, and what this module
// writes is compliance state: an unsubscribe that is lost keeps mailing
// someone who asked us to stop, and a suppression that is wrong silences a
// good address at every rooftop in the group. Each failure these tests pin
// down was real:
//
//   - effects were gated on "row created in the last 5 seconds", so a slow
//     insert dropped them and a quick redelivery applied them twice;
//   - the event row committed before its effects, and the route answered 200
//     either way, so a database blip lost the effect for good;
//   - every bounce and drop suppressed, including the receiving server
//     blocking US, and a later drop could turn an unsubscribe into a 'bounce';
//   - Apple Mail Privacy Protection opens counted as the contact opening.
//
// Prisma is replaced by an in-memory stand-in for the tables involved. Its
// $transaction is real enough to matter: writes land in a staged copy that
// only becomes the committed state if the callback resolves, so "a failure
// rolls the event row back" is observed here, not assumed.

interface RecipientRow {
  id: string;
  campaignId: string;
  accountKey: string;
  email: string | null;
  status: string;
  error: string | null;
  messageId: string | null;
}

interface BlastRow {
  id: string;
  sentCount: number;
  failedCount: number;
  bouncedCount: number;
}

interface SuppressionRow {
  accountKey: string;
  email: string;
  reason: string;
  source: string;
  raw: string | null;
}

interface Db {
  events: Map<string, Record<string, unknown>>;
  recipients: Map<string, RecipientRow>;
  blasts: Map<string, BlastRow>;
  /** Keyed `${accountKey}|${email}`, the table's unique pair. */
  suppressions: Map<string, SuppressionRow>;
  contactWrites: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
}

function emptyDb(): Db {
  return {
    events: new Map(),
    recipients: new Map(),
    blasts: new Map(),
    suppressions: new Map(),
    contactWrites: [],
  };
}

const store = { committed: emptyDb() };

/** Every call, in order — for asserting what ran and what didn't. */
const calls: string[] = [];

/** Make the named call throw, once. */
const faults = new Map<string, Error>();

/** Runs inside emailEvent.createMany, before it writes. */
let duringEventInsert: (() => void) | null = null;

function hit(name: string): void {
  calls.push(name);
  const fault = faults.get(name);
  if (fault) {
    faults.delete(name);
    throw fault;
  }
}

function inList(condition: unknown): string[] {
  return (condition as { in: string[] }).in;
}

// The stand-in reads Prisma-shaped arguments loosely; the module under test is
// what's typed against the real client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = Record<string, any>;

function clientFor(db: () => Db) {
  return {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      hit('$queryRaw');
      calls.push(`sql:${strings.join('?').replace(/\s+/g, ' ').trim()}|${values.join(',')}`);
      return [];
    },
    emailEvent: {
      async createMany({ data, skipDuplicates }: Args) {
        hit('emailEvent.createMany');
        duringEventInsert?.();
        let count = 0;
        for (const row of data as Array<Record<string, unknown>>) {
          const key = row.sgEventId as string;
          if (db().events.has(key)) {
            if (!skipDuplicates) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
            continue;
          }
          db().events.set(key, { ...row });
          count += 1;
        }
        return { count };
      },
    },
    emailBlastRecipient: {
      async findMany({ where }: Args) {
        hit('emailBlastRecipient.findMany');
        const rows = [...db().recipients.values()];
        const matched = where.id
          ? rows.filter((r) => inList(where.id).includes(r.id))
          : rows.filter((r) => r.messageId !== null && inList(where.messageId).includes(r.messageId));
        return matched.map(({ id, campaignId, accountKey, email, messageId }) => ({
          id,
          campaignId,
          accountKey,
          email,
          ...(where.messageId ? { messageId } : {}),
        }));
      },
      async updateMany({ where, data }: Args) {
        hit('emailBlastRecipient.updateMany');
        const row = db().recipients.get(where.id);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      async groupBy({ where }: Args) {
        hit('emailBlastRecipient.groupBy');
        const counts = new Map<string, number>();
        for (const r of db().recipients.values()) {
          if (r.campaignId === where.campaignId) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
        }
        return [...counts].map(([status, n]) => ({ status, _count: { _all: n } }));
      },
    },
    emailBlast: {
      async updateMany({ where, data }: Args) {
        hit('emailBlast.updateMany');
        const row = db().blasts.get(where.id);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    emailSuppression: {
      async createMany({ data, skipDuplicates }: Args) {
        hit('emailSuppression.createMany');
        let count = 0;
        for (const row of data as SuppressionRow[]) {
          const key = `${row.accountKey}|${row.email}`;
          if (db().suppressions.has(key)) {
            if (!skipDuplicates) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
            continue;
          }
          db().suppressions.set(key, { ...row });
          count += 1;
        }
        return { count };
      },
      async updateMany({ where, data }: Args) {
        hit('emailSuppression.updateMany');
        let count = 0;
        for (const row of db().suppressions.values()) {
          if (
            inList(where.accountKey).includes(row.accountKey) &&
            row.email === where.email &&
            inList(where.reason).includes(row.reason)
          ) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    contact: {
      async updateMany({ where, data }: Args) {
        hit('contact.updateMany');
        db().contactWrites.push({ where, data });
        return { count: 1 };
      },
    },
  };
}

const rootClient = {
  ...clientFor(() => store.committed),
  async $transaction(fn: (tx: unknown) => Promise<unknown>) {
    hit('$transaction');
    const staged = structuredClone(store.committed);
    const result = await fn(clientFor(() => staged));
    store.committed = staged; // reached only when the callback resolved
    return result;
  },
};

const related: Record<string, string[]> = {};
const getRelatedAccountKeys = vi.fn(async (key: string) => related[key] ?? []);

vi.mock('@/lib/prisma', () => ({ prisma: rootClient }));
vi.mock('@/lib/services/accounts', () => ({
  getRelatedAccountKeys: (key: string) => getRelatedAccountKeys(key),
}));

const {
  processSendGridEventBatch,
  suppressionReasonFor,
  suppressionReasonForDrop,
  sendMessageIdOf,
  recordedEventType,
} = await import('./sendgrid-events');

// ── Fixtures ──

const T0 = 1_760_280_000; // 2025-10-12, seconds

function seed() {
  const db = emptyDb();
  db.blasts.set('blast-1', { id: 'blast-1', sentCount: 99, failedCount: 99, bouncedCount: 99 });
  const rows: RecipientRow[] = [
    { id: 'r-1', campaignId: 'blast-1', accountKey: 'young-chev', email: 'pat@example.com', status: 'sent', error: null, messageId: 'Xk2ab9QtR0aBcD' },
    { id: 'r-2', campaignId: 'blast-1', accountKey: 'young-chev', email: 'sam@example.com', status: 'sent', error: null, messageId: 'Ym3bc0RuS1bCdE' },
    { id: 'r-3', campaignId: 'blast-1', accountKey: 'young-chev', email: 'lee@example.com', status: 'failed', error: 'SendGrid: timeout', messageId: null },
    { id: 'r-4', campaignId: 'blast-1', accountKey: 'young-chev', email: 'kim@example.com', status: 'bounced', error: 'bounce: 550', messageId: 'Zn4cd1SvT2cDeF' },
    { id: 'r-5', campaignId: 'blast-1', accountKey: 'young-chev', email: 'max@example.com', status: 'pending', error: null, messageId: null },
  ];
  for (const row of rows) db.recipients.set(row.id, row);
  return db;
}

/** An event for r-1 with the custom args the send loop stamps. */
function eventFor(overrides: Record<string, unknown>) {
  return {
    email: 'pat@example.com',
    timestamp: T0,
    sg_message_id: 'Xk2ab9QtR0aBcD.filterdrecv-5bf99c48d-wbsbg-20-5DA8F2D9-24.0',
    campaignId: 'blast-1',
    recipientId: 'r-1',
    accountKey: 'young-chev',
    ...overrides,
  };
}

const hardBounce = (id = 'evt-bounce') =>
  eventFor({
    event: 'bounce',
    sg_event_id: id,
    type: 'bounce',
    bounce_classification: 'Invalid Address',
    reason: '550 5.1.1 The email account that you tried to reach does not exist',
  });

const suppression = (accountKey: string, email = 'pat@example.com') =>
  store.committed.suppressions.get(`${accountKey}|${email}`);

const count = (name: string) => calls.filter((c) => c === name).length;

beforeEach(() => {
  store.committed = seed();
  calls.length = 0;
  faults.clear();
  duringEventInsert = null;
  for (const key of Object.keys(related)) delete related[key];
  related['young-chev'] = ['young-honda', 'young-ford'];
  getRelatedAccountKeys.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Idempotency ──

describe('idempotency', () => {
  it('applies a redelivered event exactly once', async () => {
    const first = await processSendGridEventBatch([hardBounce()]);
    const second = await processSendGridEventBatch([hardBounce()]);

    expect(first[0].status).toBe('persisted');
    expect(second[0].status).toBe('duplicate');

    // The second delivery's transaction did nothing past the insert.
    expect(count('emailSuppression.createMany')).toBe(1);
    expect(count('emailBlastRecipient.updateMany')).toBe(1);
    expect(count('$queryRaw')).toBe(1);
    expect(store.committed.events.size).toBe(1);
  });

  it('still applies the effects when the insert is slow', async () => {
    // The old code compared the row's createdAt with "now" and skipped the
    // effects past 5 seconds, so a slow insert became a lost bounce. Nothing
    // in the decision depends on the clock any more.
    vi.useFakeTimers({ now: new Date('2026-10-12T15:00:00Z') });
    duringEventInsert = () => vi.setSystemTime(new Date('2026-10-12T15:00:30Z'));

    const [outcome] = await processSendGridEventBatch([hardBounce()]);

    expect(outcome.status).toBe('persisted');
    expect(store.committed.recipients.get('r-1')?.status).toBe('bounced');
    expect(suppression('young-chev')?.reason).toBe('bounce');
  });

  it('treats duplicates within one batch the same way', async () => {
    const outcomes = await processSendGridEventBatch([hardBounce(), hardBounce()]);
    expect(outcomes.map((o) => o.status)).toEqual(['persisted', 'duplicate']);
    expect(count('emailSuppression.createMany')).toBe(1);
  });
});

// ── Atomicity ──

describe('atomicity', () => {
  it('rolls the event row back with its effects, so a redelivery applies it whole', async () => {
    faults.set('emailSuppression.createMany', new Error('Connection terminated unexpectedly'));

    const [failed] = await processSendGridEventBatch([hardBounce()]);
    expect(failed.status).toBe('failed');
    expect(failed.reason).toContain('Connection terminated');

    // Nothing survived — not the event row, not the recipient write that ran
    // before the failure.
    expect(store.committed.events.size).toBe(0);
    expect(store.committed.recipients.get('r-1')?.status).toBe('sent');
    expect(store.committed.blasts.get('blast-1')?.sentCount).toBe(99);

    const [retried] = await processSendGridEventBatch([hardBounce()]);
    expect(retried.status).toBe('persisted');
    expect(store.committed.recipients.get('r-1')?.status).toBe('bounced');
    expect(suppression('young-chev')?.reason).toBe('bounce');
  });

  it('keeps going after one event fails, and reports which', async () => {
    faults.set('emailSuppression.createMany', new Error('deadlock detected'));
    const outcomes = await processSendGridEventBatch([
      hardBounce('evt-1'),
      eventFor({ event: 'delivered', sg_event_id: 'evt-2' }),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(['failed', 'persisted']);
  });

  it('fails every event when the recipient lookup itself fails', async () => {
    faults.set('emailBlastRecipient.findMany', new Error('too many clients already'));
    const outcomes = await processSendGridEventBatch([
      hardBounce('evt-1'),
      eventFor({ event: 'open', sg_event_id: 'evt-2' }),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(['failed', 'failed']);
    expect(store.committed.events.size).toBe(0);
  });

  it('acknowledges malformed entries as invalid, not failed', async () => {
    const outcomes = await processSendGridEventBatch([
      { event: 'open' }, // no sg_event_id
      { sg_event_id: 'evt-x' }, // no event type
      null,
      'not an event',
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(['invalid', 'invalid', 'invalid', 'invalid']);
    expect(calls).toEqual([]);
  });
});

// ── Which bounces and drops suppress ──

describe('bounces', () => {
  it('suppresses a hard bounce and cascades it across the group', async () => {
    await processSendGridEventBatch([hardBounce()]);

    for (const key of ['young-chev', 'young-honda', 'young-ford']) {
      expect(suppression(key)).toMatchObject({ reason: 'bounce', source: 'sendgrid' });
    }
    expect(store.committed.recipients.get('r-1')).toMatchObject({
      status: 'bounced',
      error: 'bounce: 550 5.1.1 The email account that you tried to reach does not exist',
    });
  });

  it('records a blocked bounce without suppressing the address', async () => {
    await processSendGridEventBatch([
      eventFor({
        event: 'bounce',
        sg_event_id: 'evt-blocked',
        type: 'blocked',
        bounce_classification: 'Reputation',
        reason: '550 5.7.1 Service unavailable; client host blocked using Spamhaus',
      }),
    ]);

    expect(store.committed.suppressions.size).toBe(0);
    expect(getRelatedAccountKeys).not.toHaveBeenCalled();
    // Still not delivered, and the row says why in a way a reader can tell
    // apart from a dead mailbox.
    expect(store.committed.recipients.get('r-1')).toMatchObject({
      status: 'bounced',
      error: 'bounce (blocked): 550 5.7.1 Service unavailable; client host blocked using Spamhaus',
    });
    expect(store.committed.events.get('evt-blocked')?.eventType).toBe('bounce');
  });

  it.each([
    ['Reputation'],
    ['Content'],
    ['Frequency or Volume'],
    ['Technical'],
  ])('does not suppress a %s bounce', async (classification) => {
    await processSendGridEventBatch([
      eventFor({ event: 'bounce', sg_event_id: 'evt', type: 'bounce', bounce_classification: classification }),
    ]);
    expect(store.committed.suppressions.size).toBe(0);
    expect(store.committed.recipients.get('r-1')?.status).toBe('bounced');
  });

  it('decides bounce suppression from type and classification', () => {
    const bounce = (type: string | undefined, classification: string | undefined) =>
      suppressionReasonFor({ event: 'bounce', type, bounce_classification: classification });

    expect(bounce('bounce', 'Invalid Address')).toBe('bounce');
    expect(bounce('bounce', 'Mailbox Unavailable')).toBe('bounce');
    expect(bounce('bounce', 'Unclassified')).toBe('bounce');
    expect(bounce('bounce', undefined)).toBe('bounce');
    expect(bounce(undefined, undefined)).toBe('bounce');
    expect(bounce('blocked', 'Invalid Address')).toBeNull();
    expect(bounce('Blocked', undefined)).toBeNull();
    expect(bounce('expired', undefined)).toBeNull();
    expect(bounce('bounce', 'frequency or volume')).toBeNull();
  });

  it('keeps suppressing spam reports and unsubscribes', () => {
    expect(suppressionReasonFor({ event: 'spamreport' })).toBe('spamreport');
    expect(suppressionReasonFor({ event: 'unsubscribe' })).toBe('unsubscribe');
    expect(suppressionReasonFor({ event: 'group_unsubscribe' })).toBe('unsubscribe');
    expect(suppressionReasonFor({ event: 'deferred' })).toBeNull();
  });
});

describe('drops', () => {
  it('does not suppress an address over our own content', async () => {
    await processSendGridEventBatch([
      eventFor({ event: 'dropped', sg_event_id: 'evt-drop', reason: 'Spam Content (if spam checker app is enabled)' }),
    ]);
    expect(store.committed.suppressions.size).toBe(0);
    expect(store.committed.recipients.get('r-1')).toMatchObject({
      status: 'bounced',
      error: 'dropped: Spam Content (if spam checker app is enabled)',
    });
  });

  it('suppresses an Unsubscribed Address drop as an unsubscribe', async () => {
    await processSendGridEventBatch([
      eventFor({ event: 'dropped', sg_event_id: 'evt-drop', reason: 'Unsubscribed Address' }),
    ]);
    expect(suppression('young-chev')?.reason).toBe('unsubscribe');
    expect(suppression('young-ford')?.reason).toBe('unsubscribe');
  });

  it.each([
    ['Bounced Address', 'bounce'],
    ['bounced address', 'bounce'],
    ['Unsubscribed Address', 'unsubscribe'],
    ['Unsubscribed Group', 'unsubscribe'],
    ['Spam Reporting Address', 'spamreport'],
    ['Invalid', 'bounce'],
    ['Invalid Address', 'bounce'],
    ['Spam Content (if spam checker app is enabled)', null],
    ['Exceeded Quota', null],
    ['Recipient List over Package Quota', null],
    ['Invalid SMTPAPI header', null],
    ['Something SendGrid adds next year', null],
    ['', null],
    [undefined, null],
  ])('maps drop reason %j to %j', (reason, expected) => {
    expect(suppressionReasonForDrop(reason)).toBe(expected);
  });
});

// ── Reason precedence ──

describe('suppression reason precedence', () => {
  it('never downgrades an unsubscribe to a bounce', async () => {
    store.committed.suppressions.set('young-chev|pat@example.com', {
      accountKey: 'young-chev',
      email: 'pat@example.com',
      reason: 'unsubscribe',
      source: 'sendgrid',
      raw: null,
    });

    await processSendGridEventBatch([
      eventFor({ event: 'dropped', sg_event_id: 'evt-drop', reason: 'Bounced Address' }),
    ]);

    // Deleting a row clears the SendGrid list its reason names; as a 'bounce'
    // this one would leave the address on SendGrid's unsubscribe list.
    expect(suppression('young-chev')?.reason).toBe('unsubscribe');
    // Siblings that had nothing still get the new row.
    expect(suppression('young-honda')?.reason).toBe('bounce');
  });

  it('upgrades a weaker reason', async () => {
    store.committed.suppressions.set('young-chev|pat@example.com', {
      accountKey: 'young-chev',
      email: 'pat@example.com',
      reason: 'bounce',
      source: 'sendgrid',
      raw: null,
    });
    store.committed.suppressions.set('young-honda|pat@example.com', {
      accountKey: 'young-honda',
      email: 'pat@example.com',
      reason: 'manual',
      source: 'manual',
      raw: null,
    });

    await processSendGridEventBatch([eventFor({ event: 'spamreport', sg_event_id: 'evt-spam' })]);

    expect(suppression('young-chev')?.reason).toBe('spamreport');
    expect(suppression('young-honda')).toMatchObject({ reason: 'spamreport', source: 'manual' });
    expect(suppression('young-ford')?.reason).toBe('spamreport');
  });

  it('leaves a manual suppression alone when a bounce arrives', async () => {
    store.committed.suppressions.set('young-chev|pat@example.com', {
      accountKey: 'young-chev',
      email: 'pat@example.com',
      reason: 'manual',
      source: 'manual',
      raw: null,
    });
    await processSendGridEventBatch([hardBounce()]);
    expect(suppression('young-chev')?.reason).toBe('manual');
  });
});

// ── Recipient state and counters ──

describe('recipient status and blast counters', () => {
  it('recomputes the counters from the rows instead of nudging them', async () => {
    await processSendGridEventBatch([hardBounce()]);

    // r-1 sent → bounced. Recounted: r-2 sent; r-3 failed; r-1, r-4 bounced.
    // r-5 is pending and in none of the three.
    expect(store.committed.blasts.get('blast-1')).toMatchObject({
      sentCount: 1,
      failedCount: 1,
      bouncedCount: 2,
    });
  });

  it('locks the blast row before counting, so concurrent recounts serialize', async () => {
    await processSendGridEventBatch([hardBounce()]);

    const lock = calls.findIndex((c) => c.startsWith('sql:SELECT id FROM "EmailCampaign"'));
    expect(lock).toBeGreaterThan(-1);
    expect(calls[lock]).toContain('FOR UPDATE');
    expect(calls[lock]).toContain('|blast-1');
    expect(lock).toBeLessThan(calls.indexOf('emailBlastRecipient.groupBy'));
    // And after the recipient write it has to reflect.
    expect(calls.indexOf('emailBlastRecipient.updateMany')).toBeLessThan(lock);
  });

  it('records a drop that lands before the send loop marked the row sent', async () => {
    await processSendGridEventBatch([
      eventFor({
        event: 'dropped',
        sg_event_id: 'evt-early',
        recipientId: 'r-5',
        email: 'max@example.com',
        reason: 'Bounced Address',
      }),
    ]);
    expect(store.committed.recipients.get('r-5')).toMatchObject({
      status: 'bounced',
      error: 'dropped: Bounced Address',
    });
  });

  it('logs an event for a recipient that no longer exists without touching rows', async () => {
    const [outcome] = await processSendGridEventBatch([
      eventFor({ event: 'bounce', sg_event_id: 'evt-gone', recipientId: 'r-deleted', type: 'bounce' }),
    ]);
    expect(outcome.status).toBe('persisted');
    expect(store.committed.events.get('evt-gone')?.recipientId).toBeNull();
    expect(count('emailBlastRecipient.updateMany')).toBe(0);
    // The custom args still name the account, so the address is suppressed.
    expect(suppression('young-chev')?.reason).toBe('bounce');
  });
});

// ── Missing custom args ──

describe('events without custom args', () => {
  const bareBounce = (overrides: Record<string, unknown> = {}) => ({
    event: 'bounce',
    sg_event_id: 'evt-bare',
    type: 'bounce',
    bounce_classification: 'Invalid Address',
    email: 'Sam@Example.com ',
    timestamp: T0,
    sg_message_id: 'Ym3bc0RuS1bCdE.filterdrecv-p3las1-5bf99c48d-wbsbg-20-5DA8F2D9-24.0',
    ...overrides,
  });

  it('recovers the recipient, blast and account from the SendGrid message id', async () => {
    const [outcome] = await processSendGridEventBatch([bareBounce()]);

    expect(outcome.status).toBe('persisted');
    expect(store.committed.events.get('evt-bare')).toMatchObject({
      recipientId: 'r-2',
      campaignId: 'blast-1',
      accountKey: 'young-chev',
      email: 'sam@example.com',
    });
    expect(store.committed.recipients.get('r-2')?.status).toBe('bounced');
    expect(suppression('young-chev', 'sam@example.com')?.reason).toBe('bounce');
    expect(suppression('young-ford', 'sam@example.com')?.reason).toBe('bounce');
  });

  it('logs an event it cannot attach, and suppresses nothing', async () => {
    const [outcome] = await processSendGridEventBatch([
      bareBounce({ sg_message_id: 'Unknown0000.filter0001.16648.5515E0B88.0' }),
    ]);
    expect(outcome.status).toBe('persisted');
    expect(store.committed.events.get('evt-bare')).toMatchObject({
      recipientId: null,
      campaignId: null,
      accountKey: null,
    });
    expect(store.committed.suppressions.size).toBe(0);
    expect(count('$transaction')).toBe(0);
  });

  it('refuses a message-id match whose address disagrees with the event', async () => {
    await processSendGridEventBatch([bareBounce({ email: 'someone-else@example.com' })]);
    expect(store.committed.events.get('evt-bare')?.recipientId).toBeNull();
    expect(store.committed.recipients.get('r-2')?.status).toBe('sent');
    expect(store.committed.suppressions.size).toBe(0);
  });

  it('looks the whole batch up in one query, not one per event', async () => {
    await processSendGridEventBatch([
      bareBounce({ sg_event_id: 'a' }),
      bareBounce({ sg_event_id: 'b', event: 'delivered' }),
      bareBounce({ sg_event_id: 'c', event: 'open' }),
    ]);
    expect(count('emailBlastRecipient.findMany')).toBe(1);
  });

  it('takes the id before the first dot of sg_message_id', () => {
    expect(sendMessageIdOf('Xk2ab9QtR0aBcD.filterdrecv-5bf99c48d.0')).toBe('Xk2ab9QtR0aBcD');
    expect(sendMessageIdOf('Xk2ab9QtR0aBcD')).toBe('Xk2ab9QtR0aBcD');
    expect(sendMessageIdOf('.filter')).toBeNull();
    expect(sendMessageIdOf(undefined)).toBeNull();
  });
});

// ── Machine opens ──

describe('machine opens', () => {
  it('stores an Apple MPP open as machine_open and leaves the contact alone', async () => {
    const [outcome] = await processSendGridEventBatch([
      eventFor({ event: 'open', sg_event_id: 'evt-mpp', sg_machine_open: true }),
    ]);

    expect(outcome.status).toBe('persisted');
    expect(store.committed.events.get('evt-mpp')?.eventType).toBe('machine_open');
    expect(store.committed.contactWrites).toEqual([]);
    expect(count('contact.updateMany')).toBe(0);
  });

  it('still counts a human open as an open and moves lastEmailOpenedAt', async () => {
    await processSendGridEventBatch([
      eventFor({ event: 'open', sg_event_id: 'evt-open', sg_machine_open: false }),
    ]);

    expect(store.committed.events.get('evt-open')?.eventType).toBe('open');
    expect(store.committed.contactWrites).toHaveLength(1);
    expect(store.committed.contactWrites[0].data).toEqual({
      lastEmailOpenedAt: new Date(T0 * 1000),
    });
    expect(store.committed.contactWrites[0].where).toMatchObject({
      accountKey: 'young-chev',
      email: 'pat@example.com',
    });
  });

  it('reads the flag leniently', () => {
    expect(recordedEventType({ event: 'open', sg_machine_open: 'true' as unknown as boolean })).toBe('machine_open');
    expect(recordedEventType({ event: 'open' })).toBe('open');
    expect(recordedEventType({ event: 'click', sg_machine_open: true })).toBe('click');
  });

  it('moves lastMessageAt as well as lastEmailDeliveredAt on a delivery', async () => {
    await processSendGridEventBatch([eventFor({ event: 'delivered', sg_event_id: 'evt-d' })]);
    expect(store.committed.contactWrites.map((w) => Object.keys(w.data)[0])).toEqual([
      'lastEmailDeliveredAt',
      'lastMessageAt',
    ]);
  });
});
