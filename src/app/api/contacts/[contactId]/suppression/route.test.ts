import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeDb, prismaFor, type FakeDb } from '@/lib/sending/__fixtures__/suppression-db';

// The contact page's Email / SMS opt-out toggle. What it got wrong:
//   - it showed the dnd flag alone, so a person who unsubscribed through a
//     SendGrid link (a row, no flag) showed as mailable;
//   - turning it off deleted EVERY row for the address — including the
//     person's own unsubscribe, a spam report, a bounce;
//   - turning it on stored the contact's address verbatim, so a mixed-case
//     email made a row the lowercased send-time lookup never found.

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
}));

const { GET, PATCH } = await import('./route');

function url(contactId: string, accountKey = 'rooftopA') {
  return `https://studio.loomilm.com/api/contacts/${contactId}/suppression?accountKey=${accountKey}`;
}

async function get(contactId = 'c1', accountKey = 'rooftopA') {
  const res = await GET(new NextRequest(url(contactId, accountKey)), {
    params: Promise.resolve({ contactId }),
  });
  return { status: res.status, body: await res.json() };
}

async function patch(body: Record<string, unknown>, contactId = 'c1') {
  const res = await PATCH(
    new NextRequest(url(contactId), { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ contactId }) },
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  state.db = createFakeDb();
  related.clear();
  related.set('rooftopA', ['youngGroup', 'rooftopB']);
  session.user.role = 'super_admin';
  session.user.accountKeys = [];
  state.db.contact.seed({ id: 'c1', accountKey: 'rooftopA', email: 'jane@x.com', phone: '+18015550134' });
});

describe('GET — what the toggle shows', () => {
  it('shows a webhook unsubscribe as opted out, locked, with no dnd flag', async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'jane@x.com', reason: 'unsubscribe', source: 'sendgrid' });
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.dnd).toEqual({ email: true, sms: false });
    expect(body.optOuts.email).toMatchObject({ optedOut: true, flag: false, lockedBy: 'unsubscribed' });
  });

  it('shows a STOP reply on the SMS side', async () => {
    state.db.smsSuppression.seed({ accountKey: 'rooftopA', phone: '+18015550134', reason: 'stop', source: 'twilio' });
    const { body } = await get();
    expect(body.dnd).toEqual({ email: false, sms: true });
  });

  it('keeps the scope checks', async () => {
    session.user.role = 'admin';
    session.user.accountKeys = ['someOtherAccount'];
    expect((await get()).status).toBe(403);
    session.user.role = 'client';
    session.user.accountKeys = [];
    expect((await get()).status).toBe(403);
    session.user.accountKeys = ['rooftopA'];
    expect((await get()).status).toBe(200);
  });

  it("404s a contact that isn't in the account", async () => {
    expect((await get('c1', 'rooftopB')).status).toBe(404);
  });
});

describe('PATCH on', () => {
  it('stores the lowercased address at every account in the group and mirrors sibling contacts', async () => {
    state.db.contact.rows[0].email = 'Jane@X.com';
    state.db.contact.seed({ id: 'sib', accountKey: 'rooftopB', email: 'jane@x.com' });

    const { status, body } = await patch({ email: true });

    expect(status).toBe(200);
    expect(Object.keys(state.db.emailSuppression.byAccount('jane@x.com')).sort()).toEqual([
      'rooftopA',
      'rooftopB',
      'youngGroup',
    ]);
    expect(state.db.emailSuppression.byAccount('Jane@X.com')).toEqual({});
    expect(state.db.contact.get('c1')?.dnd).toEqual({ email: true });
    expect(state.db.contact.get('sib')?.dnd).toEqual({ email: true });
    expect(body.dnd).toEqual({ email: true, sms: false });
    expect(body.optOuts.email.lockedBy).toBeNull();
  });
});

describe('PATCH off', () => {
  it('removes what staff set, across the group, and turns the channel off', async () => {
    await patch({ email: true });
    const { body } = await patch({ email: false });
    expect(state.db.emailSuppression.rows).toHaveLength(0);
    expect(state.db.contact.get('c1')?.dnd).toEqual({ email: false });
    expect(body.dnd.email).toBe(false);
  });

  it("won't remove a person's own unsubscribe — the channel stays on and says why", async () => {
    const t = state.db.emailSuppression;
    t.seed({ accountKey: 'rooftopA', email: 'jane@x.com', reason: 'unsubscribe', source: 'sendgrid' });
    t.seed({ accountKey: 'rooftopB', email: 'jane@x.com', reason: 'manual', source: 'manual' });
    state.db.contact.rows[0].dnd = { email: true };
    state.db.contact.seed({ id: 'sib', accountKey: 'rooftopB', email: 'jane@x.com', dnd: { email: true } });

    const { status, body } = await patch({ email: false });

    expect(status).toBe(200);
    expect(t.byAccount('jane@x.com')).toEqual({ rooftopA: { reason: 'unsubscribe', source: 'sendgrid' } });
    expect(state.db.contact.get('c1')?.dnd).toEqual({ email: true });
    expect(body.dnd.email).toBe(true);
    expect(body.optOuts.email.lockedBy).toBe('unsubscribed');
    // rooftopB only had staff's row, so its contact is free to drop the flag.
    expect(state.db.contact.get('sib')?.dnd).toEqual({ email: false });
  });

  it.each([
    ['spamreport', 'sendgrid', 'spam'],
    ['bounce', 'sendgrid', 'bounced'],
    ['manual', 'import', 'imported'],
  ])("won't remove a %s row (source %s)", async (reason, source, lock) => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'jane@x.com', reason, source });
    const { body } = await patch({ email: false });
    expect(state.db.emailSuppression.byAccount('jane@x.com').rooftopA).toEqual({ reason, source });
    expect(body.optOuts.email).toMatchObject({ optedOut: true, lockedBy: lock });
  });

  it("won't remove a STOP reply", async () => {
    state.db.smsSuppression.seed({ accountKey: 'rooftopA', phone: '+18015550134', reason: 'stop', source: 'twilio' });
    const { body } = await patch({ sms: false });
    expect(state.db.smsSuppression.rows).toHaveLength(1);
    expect(body.dnd.sms).toBe(true);
    expect(body.optOuts.sms.lockedBy).toBe('unsubscribed');
  });

  it('clears a CRM opt-out', async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'jane@x.com', reason: 'crm-optout', source: 'oz-reports' });
    const { body } = await patch({ email: false });
    expect(state.db.emailSuppression.rows).toHaveLength(0);
    expect(body.dnd.email).toBe(false);
  });
});

describe('PATCH validation', () => {
  it('needs an email or sms boolean', async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ email: 'yes' })).status).toBe(400);
  });

  it('keeps the admin scope check', async () => {
    session.user.role = 'admin';
    session.user.accountKeys = ['someOtherAccount'];
    expect((await patch({ email: true })).status).toBe(403);
    expect(state.db.emailSuppression.rows).toHaveLength(0);
  });
});
