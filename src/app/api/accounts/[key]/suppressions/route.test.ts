import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeDb, prismaFor, type FakeDb } from '@/lib/sending/__fixtures__/suppression-db';

// Settings → Suppressions. "Add manually" used to write one row at one
// account, and its upsert overwrote the reason — re-adding someone who had
// unsubscribed as 'manual' relabeled their unsubscribe as something staff may
// clear. The list was also email-only, so imported phone numbers had nowhere
// to be seen.

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

const { GET, POST } = await import('./route');

const params = { params: Promise.resolve({ key: 'rooftopA' }) };

async function add(body: Record<string, unknown>) {
  const res = await POST(
    new NextRequest('https://studio.loomilm.com/api/accounts/rooftopA/suppressions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    params,
  );
  return { status: res.status, body: await res.json() };
}

async function list(query: string) {
  const res = await GET(
    new NextRequest(`https://studio.loomilm.com/api/accounts/rooftopA/suppressions?${query}`),
    params,
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  state.db = createFakeDb();
  related.clear();
  related.set('rooftopA', ['youngGroup', 'rooftopB']);
  session.user.role = 'super_admin';
  session.user.accountKeys = [];
});

describe('POST — add manually', () => {
  it('suppresses the address at every account in the group', async () => {
    const { status, body } = await add({ email: ' Ann@X.com ' });
    expect(status).toBe(201);
    expect(body.accounts).toBe(3);
    const manual = { reason: 'manual', source: 'manual' };
    expect(state.db.emailSuppression.byAccount('ann@x.com')).toEqual({
      rooftopA: manual,
      youngGroup: manual,
      rooftopB: manual,
    });
  });

  it("doesn't relabel an unsubscribe as manual", async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'ann@x.com', reason: 'unsubscribe', source: 'sendgrid' });
    const { body } = await add({ email: 'ann@x.com', reason: 'manual' });
    expect(body.suppression).toMatchObject({ reason: 'unsubscribe', source: 'sendgrid' });
  });

  it('can still promote a manual entry to a stronger reason', async () => {
    await add({ email: 'ann@x.com' });
    await add({ email: 'ann@x.com', reason: 'spamreport' });
    expect(state.db.emailSuppression.byAccount('ann@x.com').rooftopA).toEqual({ reason: 'spamreport', source: 'manual' });
  });

  it('validates the address and the reason', async () => {
    expect((await add({ email: 'nope' })).status).toBe(400);
    expect((await add({ email: 'a@x.com', reason: 'crm-optout' })).status).toBe(400);
  });

  it('keeps the admin scope check', async () => {
    session.user.role = 'admin';
    session.user.accountKeys = ['rooftopB'];
    expect((await add({ email: 'a@x.com' })).status).toBe(403);
  });
});

describe('GET — the SMS list', () => {
  it('lists texting opt-outs with their reason counts', async () => {
    state.db.smsSuppression.seed({ accountKey: 'rooftopA', phone: '+18015550101', reason: 'stop', source: 'twilio' });
    state.db.smsSuppression.seed({ accountKey: 'rooftopA', phone: '+18015550102', reason: 'manual', source: 'import' });
    state.db.smsSuppression.seed({ accountKey: 'rooftopB', phone: '+18015550103', reason: 'stop', source: 'twilio' });

    const { status, body } = await list('channel=sms');

    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.rows.map((r: { phone: string }) => r.phone).sort()).toEqual(['+18015550101', '+18015550102']);
    expect(body.reasonCounts).toEqual({ stop: 1, manual: 1 });
  });

  it('searches phones by their digits', async () => {
    state.db.smsSuppression.seed({ accountKey: 'rooftopA', phone: '+18015550101', reason: 'stop', source: 'twilio' });
    state.db.smsSuppression.seed({ accountKey: 'rooftopA', phone: '+13855550199', reason: 'stop', source: 'twilio' });
    const { body } = await list(`channel=sms&search=${encodeURIComponent('(801) 555')}`);
    expect(body.rows.map((r: { phone: string }) => r.phone)).toEqual(['+18015550101']);
  });

  it('still lists email rows by default', async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'bounce', source: 'sendgrid' });
    const { body } = await list('');
    expect(body.rows.map((r: { email: string }) => r.email)).toEqual(['a@x.com']);
  });
});
