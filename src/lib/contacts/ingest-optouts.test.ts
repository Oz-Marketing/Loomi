import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, prismaFor, type FakeDb } from '@/lib/sending/__fixtures__/suppression-db';

// The CRM bridge's dnd flags, on their way in:
//   - a feed's explicit `false` used to overwrite an opt-out set in Loomi,
//     because the merge was a plain object spread;
//   - its suppression rows landed at one account, and an upsert that always
//     wrote 'crm-optout' relabeled a person's own unsubscribe as something
//     staff may clear.

const state: { db: FakeDb } = { db: createFakeDb() };
const related = new Map<string, string[]>();

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, prop) => Reflect.get(prismaFor(state.db), prop) }),
}));
vi.mock('@/lib/services/accounts', () => ({
  getRelatedAccountKeys: vi.fn(async (key: string) => related.get(key) ?? []),
}));

const { ingestContacts } = await import('./ingest');
const accounts = await import('@/lib/services/accounts');

beforeEach(() => {
  state.db = createFakeDb();
  related.clear();
  related.set('rooftopA', ['youngGroup', 'rooftopB']);
  vi.mocked(accounts.getRelatedAccountKeys).mockClear();
});

describe('ingestContacts — dnd is sticky', () => {
  it("never lets a feed's false clear an opt-out recorded in Loomi", async () => {
    state.db.contact.seed({ id: 'c1', accountKey: 'rooftopA', email: 'a@x.com', dnd: { email: true } });

    await ingestContacts({
      accountKey: 'rooftopA',
      contacts: [{ email: 'a@x.com', dnd: { email: false, sms: true } }],
    });

    expect(state.db.contact.get('c1')?.dnd).toEqual({ email: true, sms: true });
  });

  it('still lets a feed opt a channel out', async () => {
    state.db.contact.seed({ id: 'c1', accountKey: 'rooftopA', email: 'a@x.com', dnd: { email: false } });
    await ingestContacts({ accountKey: 'rooftopA', contacts: [{ email: 'a@x.com', dnd: { email: true } }] });
    expect(state.db.contact.get('c1')?.dnd).toEqual({ email: true });
  });

  it('leaves dnd alone when the row carries none', async () => {
    state.db.contact.seed({ id: 'c1', accountKey: 'rooftopA', email: 'a@x.com', dnd: { sms: true } });
    await ingestContacts({ accountKey: 'rooftopA', contacts: [{ email: 'a@x.com', firstName: 'Ann' }] });
    expect(state.db.contact.get('c1')?.dnd).toEqual({ sms: true });
  });
});

describe('ingestContacts — CRM opt-outs reach the suppression list', () => {
  it('records crm-optout rows at every account in the group', async () => {
    await ingestContacts({
      accountKey: 'rooftopA',
      contacts: [{ email: 'New@X.com', phone: '(801) 555-0134', dnd: { email: true, sms: true } }],
    });

    const expected = { reason: 'crm-optout', source: 'oz-reports' };
    expect(state.db.emailSuppression.byAccount('new@x.com')).toEqual({
      rooftopA: expected,
      youngGroup: expected,
      rooftopB: expected,
    });
    expect(state.db.smsSuppression.byAccount('+18015550134')).toEqual({
      rooftopA: expected,
      youngGroup: expected,
      rooftopB: expected,
    });
  });

  it("doesn't relabel an unsubscribe as a CRM opt-out", async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'unsubscribe', source: 'sendgrid' });
    await ingestContacts({ accountKey: 'rooftopA', contacts: [{ email: 'a@x.com', dnd: { email: true } }] });
    expect(state.db.emailSuppression.byAccount('a@x.com').rooftopA).toEqual({
      reason: 'unsubscribe',
      source: 'sendgrid',
    });
  });

  it('opts out every address a packed email cell held', async () => {
    await ingestContacts({
      accountKey: 'rooftopA',
      contacts: [{ email: 'first@x.com;second@y.com', dnd: { email: true } }],
    });
    expect(Object.keys(state.db.emailSuppression.byAccount('first@x.com'))).toHaveLength(3);
    expect(Object.keys(state.db.emailSuppression.byAccount('second@y.com'))).toHaveLength(3);
  });

  it('writes nothing for a false flag', async () => {
    await ingestContacts({ accountKey: 'rooftopA', contacts: [{ email: 'a@x.com', dnd: { email: false } }] });
    expect(state.db.emailSuppression.rows).toHaveLength(0);
  });

  it('reads the hierarchy once per batch, not once per opted-out row', async () => {
    await ingestContacts({
      accountKey: 'rooftopA',
      contacts: [
        { email: 'a@x.com', dnd: { email: true } },
        { email: 'b@x.com', dnd: { email: true } },
        { phone: '8015550101', dnd: { sms: true } },
      ],
    });
    expect(accounts.getRelatedAccountKeys).toHaveBeenCalledTimes(1);
    expect(state.db.emailSuppression.rows).toHaveLength(6);
    expect(state.db.smsSuppression.rows).toHaveLength(3);
  });
});
