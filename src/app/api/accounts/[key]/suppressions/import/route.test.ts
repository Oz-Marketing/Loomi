import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeDb, prismaFor, type FakeDb } from '@/lib/sending/__fixtures__/suppression-db';

// Settings → Suppressions → Import: the only way to bring a list of opt-outs
// over from GoHighLevel. It has to (a) trust nothing the browser sends back,
// (b) count honestly — added / already suppressed / invalid — and (c) put
// every opt-out on every account in the group.

const state: { db: FakeDb } = { db: createFakeDb() };
const related = new Map<string, string[]>();
const session = { user: { id: 'user_7', role: 'super_admin', accountKeys: [] as string[] } };

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, prop) => Reflect.get(prismaFor(state.db), prop) }),
}));
vi.mock('@/lib/services/accounts', () => ({
  getRelatedAccountKeys: async (key: string) => related.get(key) ?? [],
}));
vi.mock('@/lib/permissions/require', () => ({
  requirePermission: vi.fn(async () => ({ session, error: null })),
}));

const { POST } = await import('./route');
const { requirePermission } = await import('@/lib/permissions/require');

async function post(body: unknown, key = 'rooftopA') {
  const res = await POST(
    new NextRequest(`https://studio.loomilm.com/api/accounts/${key}/suppressions/import`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ key }) },
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  state.db = createFakeDb();
  state.db.accounts = new Set(['rooftopA', 'rooftopB', 'youngGroup']);
  related.clear();
  related.set('rooftopA', ['youngGroup', 'rooftopB']);
  session.user.role = 'super_admin';
  session.user.accountKeys = [];
  vi.mocked(requirePermission).mockClear();
});

describe('guards', () => {
  it('uses the same permission as adding one address by hand', async () => {
    await post({ mode: 'preview', text: 'a@x.com' });
    expect(requirePermission).toHaveBeenCalledWith('agency.subaccounts.edit');
  });

  it("refuses an admin outside their accounts", async () => {
    session.user.role = 'admin';
    session.user.accountKeys = ['rooftopB'];
    expect((await post({ mode: 'commit', emails: ['a@x.com'] })).status).toBe(403);
    expect(state.db.emailSuppression.rows).toHaveLength(0);
  });

  it("404s an account that doesn't exist rather than writing orphan rows", async () => {
    expect((await post({ mode: 'commit', emails: ['a@x.com'] }, 'typo')).status).toBe(404);
  });

  it('rejects an unknown mode and a bad payload', async () => {
    expect((await post({ mode: 'nope' })).status).toBe(400);
    expect((await post({ mode: 'preview', text: '   ' })).status).toBe(400);
    expect((await post({ mode: 'commit', emails: 'a@x.com' })).status).toBe(400);
    expect((await post({ mode: 'commit', emails: [1, 2] })).status).toBe(400);
    expect((await post({ mode: 'commit' })).status).toBe(400);
  });

  it('caps a commit request and asks for batches', async () => {
    const emails = Array.from({ length: 5001 }, (_, i) => `p${i}@x.com`);
    expect((await post({ mode: 'commit', emails })).status).toBe(413);
  });
});

describe('preview', () => {
  it('counts the list without writing anything', async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'already@x.com', reason: 'bounce', source: 'sendgrid' });

    const { status, body } = await post({
      mode: 'preview',
      text: ['Already@X.com', 'new@x.com', '(801) 555-0134', 'garbage', 'new@x.com'].join('\n'),
    });

    expect(status).toBe(200);
    expect(body.emails).toEqual(['already@x.com', 'new@x.com']);
    expect(body.phones).toEqual(['+18015550134']);
    expect(body.invalid).toEqual({ count: 1, samples: ['garbage'] });
    expect(body.alreadySuppressed).toEqual({ email: 1, sms: 0 });
    expect(body.groupAccounts).toBe(3);
    expect(body.batchSize).toBeGreaterThanOrEqual(100);
    expect(body.batchSize).toBeLessThanOrEqual(2000);
    expect(state.db.emailSuppression.rows).toHaveLength(1);
  });

  it('reports the opt-out columns of a full export and the rows they skipped', async () => {
    const text = ['Email,DND', 'yes@x.com,true', 'no@x.com,false'].join('\n');
    const { body } = await post({ mode: 'preview', text });
    expect(body.emails).toEqual(['yes@x.com']);
    expect(body.optOutColumns).toEqual(['DND']);
    expect(body.notOptedOutRows).toBe(1);
  });

  it('gives a big group smaller batches', async () => {
    related.set('rooftopA', Array.from({ length: 39 }, (_, i) => `rooftop${i}`));
    const { body } = await post({ mode: 'preview', text: 'a@x.com' });
    expect(body.groupAccounts).toBe(40);
    expect(body.batchSize).toBe(500);
  });
});

describe('commit', () => {
  it('validates every address again and counts added / already suppressed / invalid', async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'already@x.com', reason: 'unsubscribe', source: 'sendgrid' });

    const { status, body } = await post({
      mode: 'commit',
      emails: ['New@X.com', 'new@x.com', 'already@x.com', 'not-an-email', 'two@x.com;three@x.com'],
      phones: ['(801) 555-0134', '555-01', '+1 801 555 0134'],
    });

    expect(status).toBe(200);
    expect(body.email).toEqual({ added: 1, alreadySuppressed: 1, invalid: 2 });
    expect(body.sms).toEqual({ added: 1, alreadySuppressed: 0, invalid: 1 });
    expect(body.groupAccounts).toBe(3);
  });

  it('suppresses at every account in the group, as reason manual / source import', async () => {
    await post({ mode: 'commit', emails: ['a@x.com'], phones: ['8015550134'] });

    const imported = { reason: 'manual', source: 'import' };
    expect(state.db.emailSuppression.byAccount('a@x.com')).toEqual({
      rooftopA: imported,
      youngGroup: imported,
      rooftopB: imported,
    });
    expect(state.db.smsSuppression.byAccount('+18015550134')).toEqual({
      rooftopA: imported,
      youngGroup: imported,
      rooftopB: imported,
    });
    expect(JSON.parse(String(state.db.emailSuppression.rows[0].raw))).toEqual({
      via: 'suppressions-import',
      userId: 'user_7',
    });
  });

  it("never downgrades what's already there", async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopB', email: 'a@x.com', reason: 'spamreport', source: 'sendgrid' });
    await post({ mode: 'commit', emails: ['a@x.com'] });
    expect(state.db.emailSuppression.byAccount('a@x.com').rooftopB).toEqual({
      reason: 'spamreport',
      source: 'sendgrid',
    });
  });

  it('is safe to re-run: a second pass adds nothing', async () => {
    await post({ mode: 'commit', emails: ['a@x.com', 'b@x.com'] });
    const { body } = await post({ mode: 'commit', emails: ['a@x.com', 'b@x.com'] });
    expect(body.email).toEqual({ added: 0, alreadySuppressed: 2, invalid: 0 });
    expect(state.db.emailSuppression.rows).toHaveLength(6);
  });
});
