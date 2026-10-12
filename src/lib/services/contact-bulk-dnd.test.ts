import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, prismaFor, type FakeDb } from '@/lib/sending/__fixtures__/suppression-db';

// Bulk "Set DND" from the contacts table used to write the dnd flag and
// nothing else. The flag is honored for that one contact only; the
// suppression rows are what every send path checks and what reaches the rest
// of the group, and bulk DND never wrote any.

const state: { db: FakeDb } = { db: createFakeDb() };
const related = new Map<string, string[]>();

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, prop) => Reflect.get(prismaFor(state.db), prop) }),
}));
vi.mock('@/lib/services/accounts', () => ({
  getRelatedAccountKeys: async (key: string) => related.get(key) ?? [],
}));
vi.mock('@/lib/services/contact-lists', () => ({ addContactsToList: async () => 0 }));

const { bulkSetDnd } = await import('./contact-bulk');

beforeEach(() => {
  state.db = createFakeDb();
  related.clear();
  related.set('rooftopA', ['youngGroup']);
  state.db.contact.seed({ id: 'c1', accountKey: 'rooftopA', email: 'Ann@X.com', phone: '+18015550101' });
  state.db.contact.seed({ id: 'c2', accountKey: 'rooftopA', email: 'bob@x.com', phone: null });
  state.db.contact.seed({ id: 'other', accountKey: 'rooftopB', email: 'eve@x.com' });
});

describe('bulkSetDnd on', () => {
  it('writes suppression rows for the group as well as the flags', async () => {
    const result = await bulkSetDnd('rooftopA', ['c1', 'c2'], { email: true });

    expect(result.affected).toBe(2);
    const manual = { reason: 'manual', source: 'manual' };
    expect(state.db.emailSuppression.byAccount('ann@x.com')).toEqual({ rooftopA: manual, youngGroup: manual });
    expect(state.db.emailSuppression.byAccount('bob@x.com')).toEqual({ rooftopA: manual, youngGroup: manual });
    expect(state.db.contact.get('c1')?.dnd).toEqual({ email: true });
    expect(state.db.smsSuppression.rows).toHaveLength(0);
  });

  it('writes rows even for a contact whose flag was already on', async () => {
    state.db.contact.get('c1')!.dnd = { sms: true };
    await bulkSetDnd('rooftopA', ['c1'], { sms: true });
    expect(Object.keys(state.db.smsSuppression.byAccount('+18015550101'))).toEqual(['rooftopA', 'youngGroup']);
  });

  it("ignores ids from another account", async () => {
    await bulkSetDnd('rooftopA', ['other'], { email: true });
    expect(state.db.emailSuppression.rows).toHaveLength(0);
    expect(state.db.contact.get('other')?.dnd).toBeNull();
  });
});

describe('bulkSetDnd off', () => {
  it('clears what staff set, and keeps anyone held by an opt-out that is not theirs', async () => {
    await bulkSetDnd('rooftopA', ['c1', 'c2'], { email: true });
    // Ann later unsubscribed herself, which the webhook recorded over staff's row.
    state.db.emailSuppression.rows
      .filter((r) => r.email === 'ann@x.com' && r.accountKey === 'rooftopA')
      .forEach((r) => Object.assign(r, { reason: 'unsubscribe' }));

    const result = await bulkSetDnd('rooftopA', ['c1', 'c2'], { email: false });

    expect(result).toEqual({ affected: 1, stillOptedOut: 1 });
    expect(state.db.emailSuppression.byAccount('bob@x.com')).toEqual({});
    expect(state.db.emailSuppression.byAccount('ann@x.com')).toEqual({
      rooftopA: { reason: 'unsubscribe', source: 'manual' },
    });
    expect(state.db.contact.get('c1')?.dnd).toEqual({ email: true });
    expect(state.db.contact.get('c2')?.dnd).toEqual({ email: false });
  });
});
