import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeDb, prismaFor, type FakeDb } from '@/lib/sending/__fixtures__/suppression-db';

// Creating or editing a contact with `dnd` used to write the flag only. The
// flag is honored for that one contact; the suppression rows are what every
// send path checks and what reaches the rest of the group.

const state: { db: FakeDb } = { db: createFakeDb() };
const related = new Map<string, string[]>();
const session = { user: { id: 'u1', role: 'super_admin', accountKeys: [] as string[] } };

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, prop) => Reflect.get(prismaFor(state.db), prop) }),
}));
vi.mock('@/lib/services/accounts', () => ({
  getRelatedAccountKeys: async (key: string) => related.get(key) ?? [],
}));
vi.mock('@/lib/permissions/require', () => ({
  requirePermission: async () => ({ session, error: null }),
}));
vi.mock('@/lib/contacts/queries', () => ({
  CONTACT_SELECT: { id: true, accountKey: true, email: true, phone: true, dnd: true },
  serializeContact: (row: unknown) => row,
  listContactsForAccount: async () => ({ contacts: [], total: 0 }),
}));

const collection = await import('./route');
const single = await import('./[contactId]/route');

async function create(body: Record<string, unknown>) {
  const res = await collection.POST(
    new NextRequest('https://studio.loomilm.com/api/contacts', { method: 'POST', body: JSON.stringify(body) }),
  );
  return { status: res.status, body: await res.json() };
}

async function update(contactId: string, body: Record<string, unknown>) {
  const res = await single.PATCH(
    new NextRequest(`https://studio.loomilm.com/api/contacts/${contactId}?accountKey=rooftopA`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ contactId }) },
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  state.db = createFakeDb();
  related.clear();
  related.set('rooftopA', ['youngGroup']);
});

describe('POST /api/contacts with dnd', () => {
  it('records the opt-outs for the group, under the normalized address', async () => {
    const { status } = await create({
      accountKey: 'rooftopA',
      email: 'New@X.com',
      phone: '(801) 555-0134',
      dnd: { email: true, sms: true },
    });
    expect(status).toBe(201);
    const manual = { reason: 'manual', source: 'manual' };
    expect(state.db.emailSuppression.byAccount('new@x.com')).toEqual({ rooftopA: manual, youngGroup: manual });
    expect(state.db.smsSuppression.byAccount('+18015550134')).toEqual({ rooftopA: manual, youngGroup: manual });
  });

  it('writes nothing for a contact created without an opt-out', async () => {
    await create({ accountKey: 'rooftopA', email: 'a@x.com', dnd: { email: false } });
    expect(state.db.emailSuppression.rows).toHaveLength(0);
  });
});

describe('PATCH /api/contacts/:id with dnd', () => {
  beforeEach(() => {
    state.db.contact.seed({ id: 'c1', accountKey: 'rooftopA', email: 'a@x.com', phone: '+18015550134', dnd: { sms: true } });
  });

  it('turning a channel on writes rows and leaves the other channel alone', async () => {
    const { status, body } = await update('c1', { dnd: { email: true } });
    expect(status).toBe(200);
    expect(Object.keys(state.db.emailSuppression.byAccount('a@x.com'))).toEqual(['rooftopA', 'youngGroup']);
    // It used to replace the whole cell, silently dropping the SMS opt-out.
    expect(body.contact.dnd).toEqual({ sms: true, email: true });
  });

  it('turning a channel off keeps it on while an opt-out staff cannot clear holds it', async () => {
    state.db.contact.get('c1')!.dnd = { email: true };
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'unsubscribe', source: 'sendgrid' });
    const { body } = await update('c1', { dnd: { email: false } });
    expect(state.db.emailSuppression.rows).toHaveLength(1);
    expect(body.contact.dnd).toEqual({ email: true });
  });

  it('carries an existing opt-out over to a new address', async () => {
    state.db.contact.get('c1')!.dnd = { email: true };
    await update('c1', { email: 'Moved@Y.com' });
    expect(Object.keys(state.db.emailSuppression.byAccount('moved@y.com'))).toEqual(['rooftopA', 'youngGroup']);
  });

  it('touches no suppression rows for an edit without dnd', async () => {
    await update('c1', { firstName: 'Ann' });
    expect(state.db.emailSuppression.rows).toHaveLength(0);
    expect(state.db.smsSuppression.rows).toHaveLength(0);
  });
});
