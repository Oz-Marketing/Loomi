import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, prismaFor, type FakeDb } from './__fixtures__/suppression-db';

// Opt-outs are compliance state: one that is recorded at a single account, or
// under an address the send path never looks up, or relabeled as something
// staff may clear, ends with someone being mailed or texted after they asked us
// to stop. Each of those happened before these helpers existed:
//
//   - the manual add, the CRM feed and bulk Set DND wrote one account's row (or
//     none) when an opt-out belongs to the whole group;
//   - the contact toggle stored the address as typed, so a mixed-case email made
//     a row the lowercased send-time lookup never matched;
//   - an always-overwrite upsert let a CRM sync turn an unsubscribe into a
//     'crm-optout', which the toggle may clear.
//
// Prisma is an in-memory stand-in, so these assert on the rows that end up
// stored, not on the calls that stored them.

const state: { db: FakeDb } = { db: createFakeDb() };
const related = new Map<string, string[]>();

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, prop) => Reflect.get(prismaFor(state.db), prop) }),
}));
vi.mock('@/lib/services/accounts', () => ({
  getRelatedAccountKeys: async (key: string) => related.get(key) ?? [],
}));

const {
  applyContactOptOutChange,
  clearStaffEmailOptOuts,
  clearStaffSmsOptOuts,
  dndAfterChange,
  isStaffClearable,
  loadContactOptOutState,
  mergeStickyDnd,
  normalizeOptOutEmail,
  normalizeOptOutPhone,
  optOutLock,
  parseOptOutList,
  reasonsWeakerThan,
  recordEmailOptOut,
  recordEmailOptOuts,
  recordSmsOptOut,
  strongestLock,
} = await import('./opt-outs');

/** youngGroup owns two rooftops; standalone has no group. */
function useGroup() {
  related.set('rooftopA', ['youngGroup', 'rooftopB']);
  related.set('rooftopB', ['youngGroup', 'rooftopA']);
  related.set('youngGroup', ['rooftopA', 'rooftopB']);
}

beforeEach(() => {
  state.db = createFakeDb();
  related.clear();
  useGroup();
});

describe('normalizing addresses', () => {
  it('stores emails trimmed and lowercased, which is how the send path looks them up', () => {
    expect(normalizeOptOutEmail('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com');
    expect(normalizeOptOutEmail('none')).toBeNull();
    expect(normalizeOptOutEmail('')).toBeNull();
    expect(normalizeOptOutEmail(null)).toBeNull();
  });

  it('stores US phones as E.164, however they were written', () => {
    expect(normalizeOptOutPhone('(801) 555-0134')).toBe('+18015550134');
    expect(normalizeOptOutPhone('1-801-555-0134')).toBe('+18015550134');
    expect(normalizeOptOutPhone('801.555.0134')).toBe('+18015550134');
    expect(normalizeOptOutPhone('+44 7911 123456')).toBe('+447911123456');
  });

  it("falls back to the digits when the country can't be known", () => {
    expect(normalizeOptOutPhone('555-0134')).toBe('5550134');
    expect(normalizeOptOutPhone('   ')).toBeNull();
  });
});

describe('reason precedence', () => {
  it('ranks spamreport > unsubscribe > manual > crm-optout > bounce', () => {
    expect(reasonsWeakerThan('spamreport')).toEqual(
      expect.arrayContaining(['unsubscribe', 'manual', 'crm-optout', 'bounce']),
    );
    expect(reasonsWeakerThan('unsubscribe')).toEqual(expect.arrayContaining(['manual', 'crm-optout', 'bounce']));
    expect(reasonsWeakerThan('unsubscribe')).not.toContain('spamreport');
    expect(reasonsWeakerThan('manual')).toEqual(expect.arrayContaining(['crm-optout', 'bounce']));
    expect(reasonsWeakerThan('manual')).not.toContain('unsubscribe');
    expect(reasonsWeakerThan('crm-optout')).toEqual(expect.arrayContaining(['bounce']));
    expect(reasonsWeakerThan('crm-optout')).not.toContain('manual');
    expect(reasonsWeakerThan('bounce')).toEqual([]);
  });

  it("puts a STOP reply with an unsubscribe, and an undelivered text with a bounce", () => {
    expect(reasonsWeakerThan('manual')).toContain('undelivered');
    expect(reasonsWeakerThan('manual')).not.toContain('stop');
    expect(reasonsWeakerThan('stop')).toContain('manual');
  });

  it('never lists a reason it does not know, so nothing overwrites one', () => {
    for (const reason of ['spamreport', 'unsubscribe', 'manual', 'crm-optout', 'bounce', 'stop']) {
      expect(reasonsWeakerThan(reason)).not.toContain('legal-hold');
    }
  });
});

describe('recordEmailOptOuts', () => {
  it('records one normalized row per address at every account in the group', async () => {
    const result = await recordEmailOptOuts({
      accountKey: 'rooftopA',
      emails: ['Jane@X.com', ' jane@x.com ', 'bob@y.com', null, 'none'],
      reason: 'manual',
      source: 'manual',
    });

    expect(result.addresses).toEqual(['jane@x.com', 'bob@y.com']);
    expect(result.accountKeys).toEqual(['rooftopA', 'youngGroup', 'rooftopB']);
    expect(result).toMatchObject({ added: 2, cascaded: 4, upgraded: 0 });
    for (const email of ['jane@x.com', 'bob@y.com']) {
      expect(state.db.emailSuppression.byAccount(email)).toEqual({
        rooftopA: { reason: 'manual', source: 'manual' },
        youngGroup: { reason: 'manual', source: 'manual' },
        rooftopB: { reason: 'manual', source: 'manual' },
      });
    }
  });

  it('writes only the one row for a standalone account', async () => {
    await recordEmailOptOut({ accountKey: 'standalone', email: 'a@x.com', reason: 'manual', source: 'manual' });
    expect(Object.keys(state.db.emailSuppression.byAccount('a@x.com'))).toEqual(['standalone']);
  });

  it('counts an address already suppressed at the account as not added', async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'bounce', source: 'sendgrid' });
    const result = await recordEmailOptOuts({
      accountKey: 'rooftopA',
      emails: ['a@x.com', 'b@x.com'],
      reason: 'manual',
      source: 'import',
    });
    expect(result.added).toBe(1);
  });

  it('never downgrades a stronger reason — an unsubscribe stays an unsubscribe', async () => {
    const t = state.db.emailSuppression;
    t.seed({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'unsubscribe', source: 'sendgrid' });
    t.seed({ accountKey: 'youngGroup', email: 'a@x.com', reason: 'spamreport', source: 'sendgrid' });
    t.seed({ accountKey: 'rooftopB', email: 'a@x.com', reason: 'manual', source: 'manual' });

    const result = await recordEmailOptOut({
      accountKey: 'rooftopA',
      email: 'a@x.com',
      reason: 'crm-optout',
      source: 'oz-reports',
    });

    expect(result.upgraded).toBe(0);
    expect(t.byAccount('a@x.com')).toEqual({
      rooftopA: { reason: 'unsubscribe', source: 'sendgrid' },
      youngGroup: { reason: 'spamreport', source: 'sendgrid' },
      rooftopB: { reason: 'manual', source: 'manual' },
    });
  });

  it('raises a weaker reason, keeping the source that first recorded the row', async () => {
    const t = state.db.emailSuppression;
    t.seed({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'bounce', source: 'sendgrid', raw: '{"type":"bounce"}' });
    t.seed({ accountKey: 'rooftopB', email: 'a@x.com', reason: 'crm-optout', source: 'oz-reports' });

    const result = await recordEmailOptOut({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'manual', source: 'manual' });

    expect(result.upgraded).toBe(2);
    expect(t.byAccount('a@x.com')).toEqual({
      rooftopA: { reason: 'manual', source: 'sendgrid' },
      youngGroup: { reason: 'manual', source: 'manual' },
      rooftopB: { reason: 'manual', source: 'oz-reports' },
    });
    // No raw was given, so the bounce's own detail stays for forensics.
    expect(t.rows.find((r) => r.accountKey === 'rooftopA')?.raw).toBe('{"type":"bounce"}');
  });

  it('leaves a reason it does not recognize alone', async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'legal-hold', source: 'ops' });
    await recordEmailOptOut({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'spamreport', source: 'manual' });
    expect(state.db.emailSuppression.byAccount('a@x.com').rooftopA).toEqual({ reason: 'legal-hold', source: 'ops' });
  });

  it('lets an import take over an equal-weight row staff could clear', async () => {
    // Staff toggled her off in Loomi; GoHighLevel says she opted out too. If
    // the row stayed staff's, turning the toggle off would drop GHL's opt-out.
    const t = state.db.emailSuppression;
    t.seed({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'manual', source: 'manual' });
    t.seed({ accountKey: 'rooftopB', email: 'a@x.com', reason: 'manual', source: 'sendgrid' });

    await recordEmailOptOut({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'manual', source: 'import', raw: '{}' });

    expect(t.byAccount('a@x.com')).toEqual({
      rooftopA: { reason: 'manual', source: 'import' },
      youngGroup: { reason: 'manual', source: 'import' },
      rooftopB: { reason: 'manual', source: 'import' },
    });
  });

  it("doesn't let a staff write take an import back", async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'manual', source: 'import' });
    await recordEmailOptOut({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'manual', source: 'manual' });
    expect(state.db.emailSuppression.byAccount('a@x.com').rooftopA).toEqual({ reason: 'manual', source: 'import' });
  });

  it('writes through the transaction client it is handed', async () => {
    const txDb = createFakeDb();
    await recordEmailOptOut({
      accountKey: 'rooftopA',
      email: 'a@x.com',
      reason: 'manual',
      source: 'manual',
      tx: prismaFor(txDb) as never,
    });
    expect(Object.keys(txDb.emailSuppression.byAccount('a@x.com'))).toHaveLength(3);
    expect(state.db.emailSuppression.rows).toHaveLength(0);
  });

  it('uses the group it is handed instead of re-reading the hierarchy', async () => {
    await recordEmailOptOut({
      accountKey: 'rooftopA',
      email: 'a@x.com',
      reason: 'manual',
      source: 'manual',
      relatedAccountKeys: ['elsewhere'],
    });
    expect(Object.keys(state.db.emailSuppression.byAccount('a@x.com')).sort()).toEqual(['elsewhere', 'rooftopA']);
  });

  it('keeps every INSERT under the bind-parameter budget for a big list in a big group', async () => {
    const emails = Array.from({ length: 4000 }, (_, i) => `person${i}@x.com`);
    const result = await recordEmailOptOuts({ accountKey: 'rooftopA', emails, reason: 'manual', source: 'import' });

    expect(result).toMatchObject({ added: 4000, cascaded: 8000 });
    expect(state.db.emailSuppression.rows).toHaveLength(12000);
    const inserts = state.db.emailSuppression.ops.filter((o) => o.op === 'createMany');
    expect(inserts.length).toBeGreaterThan(2);
    for (const insert of inserts) expect(insert.size).toBeLessThanOrEqual(5000);
  });
});

describe('recordSmsOptOut', () => {
  it('stores the phone as E.164 at every account in the group', async () => {
    await recordSmsOptOut({ accountKey: 'rooftopB', phone: '(801) 555-0134', reason: 'manual', source: 'manual' });
    expect(state.db.smsSuppression.byAccount('+18015550134')).toEqual({
      rooftopB: { reason: 'manual', source: 'manual' },
      youngGroup: { reason: 'manual', source: 'manual' },
      rooftopA: { reason: 'manual', source: 'manual' },
    });
  });

  it('never downgrades a STOP reply', async () => {
    state.db.smsSuppression.seed({ accountKey: 'rooftopA', phone: '+18015550134', reason: 'stop', source: 'twilio' });
    await recordSmsOptOut({ accountKey: 'rooftopA', phone: '801-555-0134', reason: 'crm-optout', source: 'oz-reports' });
    expect(state.db.smsSuppression.byAccount('+18015550134').rooftopA).toEqual({ reason: 'stop', source: 'twilio' });
  });
});

describe('what staff may clear', () => {
  it.each([
    [{ reason: 'manual', source: 'manual' }, true],
    [{ reason: 'crm-optout', source: 'oz-reports' }, true],
    [{ reason: 'manual', source: 'oz-reports' }, true],
    [{ reason: 'unsubscribe', source: 'sendgrid' }, false],
    [{ reason: 'unsubscribe', source: 'manual' }, false],
    [{ reason: 'spamreport', source: 'sendgrid' }, false],
    [{ reason: 'stop', source: 'twilio' }, false],
    [{ reason: 'bounce', source: 'sendgrid' }, false],
    [{ reason: 'undelivered', source: 'twilio' }, false],
    [{ reason: 'manual', source: 'import' }, false],
    [{ reason: 'manual', source: 'sendgrid' }, false],
  ])('%o → %s', (row, clearable) => {
    expect(isStaffClearable(row)).toBe(clearable);
  });

  it('names why a row locks the toggle', () => {
    expect(optOutLock({ reason: 'unsubscribe', source: 'sendgrid' })).toBe('unsubscribed');
    expect(optOutLock({ reason: 'stop', source: 'twilio' })).toBe('unsubscribed');
    expect(optOutLock({ reason: 'spamreport', source: 'sendgrid' })).toBe('spam');
    expect(optOutLock({ reason: 'bounce', source: 'sendgrid' })).toBe('bounced');
    expect(optOutLock({ reason: 'manual', source: 'sendgrid' })).toBe('bounced');
    expect(optOutLock({ reason: 'manual', source: 'import' })).toBe('imported');
    expect(optOutLock({ reason: 'manual', source: 'manual' })).toBeNull();
    expect(optOutLock({ reason: 'legal-hold', source: 'ops' })).toBe('other');
  });

  it('explains the strongest of several rows', () => {
    expect(
      strongestLock([
        { reason: 'bounce', source: 'sendgrid' },
        { reason: 'spamreport', source: 'sendgrid' },
        { reason: 'manual', source: 'manual' },
      ]),
    ).toBe('spam');
    expect(strongestLock([{ reason: 'manual', source: 'manual' }])).toBeNull();
  });
});

describe('clearStaffEmailOptOuts', () => {
  it("deletes staff and CRM opt-outs across the group and nothing that isn't theirs", async () => {
    const t = state.db.emailSuppression;
    t.seed({ accountKey: 'rooftopA', email: 'staff@x.com', reason: 'manual', source: 'manual' });
    t.seed({ accountKey: 'rooftopB', email: 'staff@x.com', reason: 'manual', source: 'manual' });
    t.seed({ accountKey: 'youngGroup', email: 'staff@x.com', reason: 'crm-optout', source: 'oz-reports' });
    t.seed({ accountKey: 'rooftopA', email: 'unsub@x.com', reason: 'unsubscribe', source: 'sendgrid' });
    t.seed({ accountKey: 'rooftopA', email: 'spam@x.com', reason: 'spamreport', source: 'sendgrid' });
    t.seed({ accountKey: 'rooftopA', email: 'bounce@x.com', reason: 'bounce', source: 'sendgrid' });
    t.seed({ accountKey: 'rooftopA', email: 'ghl@x.com', reason: 'manual', source: 'import' });

    const result = await clearStaffEmailOptOuts({
      accountKey: 'rooftopA',
      emails: ['staff@x.com', 'unsub@x.com', 'spam@x.com', 'bounce@x.com', 'ghl@x.com'],
    });

    expect(result.removed).toBe(3);
    expect(t.byAccount('staff@x.com')).toEqual({});
    expect(result.remaining.map((r) => [r.address, r.reason]).sort()).toEqual([
      ['bounce@x.com', 'bounce'],
      ['ghl@x.com', 'manual'],
      ['spam@x.com', 'spamreport'],
      ['unsub@x.com', 'unsubscribe'],
    ]);
  });

  it('hands a staff opt-out recorded over a bounce back to the bounce', async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'manual', source: 'sendgrid' });
    const result = await clearStaffEmailOptOuts({ accountKey: 'rooftopA', emails: ['a@x.com'] });
    expect(result).toMatchObject({ removed: 0, restored: 1 });
    expect(state.db.emailSuppression.byAccount('a@x.com').rooftopA).toEqual({ reason: 'bounce', source: 'sendgrid' });
  });

  it('finds a row the old toggle stored under the mixed-case address', async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'Jane@X.com', reason: 'manual', source: 'manual' });
    await clearStaffEmailOptOuts({ accountKey: 'rooftopA', emails: ['Jane@X.com'] });
    expect(state.db.emailSuppression.rows).toHaveLength(0);
  });

  it('clears texting opt-outs by any spelling of the phone', async () => {
    state.db.smsSuppression.seed({ accountKey: 'rooftopA', phone: '+18015550134', reason: 'manual', source: 'manual' });
    state.db.smsSuppression.seed({ accountKey: 'rooftopB', phone: '+18015550134', reason: 'stop', source: 'twilio' });
    const result = await clearStaffSmsOptOuts({ accountKey: 'rooftopA', phones: ['(801) 555-0134'] });
    expect(result.removed).toBe(1);
    expect(state.db.smsSuppression.byAccount('+18015550134')).toEqual({
      rooftopB: { reason: 'stop', source: 'twilio' },
    });
  });
});

describe('mergeStickyDnd', () => {
  it("keeps an opt-out when the incoming value says false", () => {
    expect(mergeStickyDnd({ email: true }, { email: false })).toEqual({ email: true });
    expect(mergeStickyDnd({ email: true, sms: true }, { email: false, sms: false })).toEqual({ email: true, sms: true });
  });

  it('lets an incoming true opt a channel out', () => {
    expect(mergeStickyDnd({ email: false }, { email: true })).toEqual({ email: true });
    expect(mergeStickyDnd(null, { sms: true })).toEqual({ sms: true });
  });

  it('records a false where nothing was set', () => {
    expect(mergeStickyDnd({}, { email: false })).toEqual({ email: false });
  });

  it('leaves channels the incoming value omits, and any other keys, alone', () => {
    expect(mergeStickyDnd({ sms: true, legacy: 'x' }, { email: true })).toEqual({ sms: true, legacy: 'x', email: true });
    expect(mergeStickyDnd({ email: true }, null)).toEqual({ email: true });
  });
});

describe('one contact: applyContactOptOutChange + dndAfterChange', () => {
  it('turning on records a manual opt-out under the lowercased address, group-wide', async () => {
    const patch = { email: true };
    const change = await applyContactOptOutChange({
      accountKey: 'rooftopA',
      email: 'Jane@X.com',
      phone: null,
      patch,
    });
    expect(Object.keys(state.db.emailSuppression.byAccount('jane@x.com'))).toHaveLength(3);
    expect(state.db.emailSuppression.byAccount('Jane@X.com')).toEqual({});
    expect(dndAfterChange(null, patch, change, 'rooftopA')).toEqual({ email: true });
  });

  it('turning off clears what staff set and drops the flag', async () => {
    await applyContactOptOutChange({ accountKey: 'rooftopA', email: 'a@x.com', phone: null, patch: { email: true } });
    const patch = { email: false };
    const change = await applyContactOptOutChange({ accountKey: 'rooftopA', email: 'a@x.com', phone: null, patch });
    expect(state.db.emailSuppression.rows).toHaveLength(0);
    expect(dndAfterChange({ email: true }, patch, change, 'rooftopA')).toEqual({ email: false });
  });

  it("can't turn off a person's own unsubscribe: the row and the flag stay", async () => {
    const t = state.db.emailSuppression;
    t.seed({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'unsubscribe', source: 'sendgrid' });
    t.seed({ accountKey: 'rooftopB', email: 'a@x.com', reason: 'manual', source: 'manual' });

    const patch = { email: false };
    const change = await applyContactOptOutChange({ accountKey: 'rooftopA', email: 'a@x.com', phone: null, patch });

    expect(t.byAccount('a@x.com')).toEqual({ rooftopA: { reason: 'unsubscribe', source: 'sendgrid' } });
    expect(dndAfterChange({ email: true }, patch, change, 'rooftopA')).toEqual({ email: true });
    // rooftopB had only a staff row, which is gone — its contact may drop the flag.
    expect(dndAfterChange({ email: true }, patch, change, 'rooftopB')).toEqual({ email: false });
  });

  it('leaves the other channel untouched', async () => {
    const change = await applyContactOptOutChange({
      accountKey: 'rooftopA',
      email: 'a@x.com',
      phone: '+18015550134',
      patch: { sms: true },
    });
    expect(state.db.emailSuppression.rows).toHaveLength(0);
    expect(dndAfterChange({ email: true }, { sms: true }, change, 'rooftopA')).toEqual({ email: true, sms: true });
  });
});

describe('loadContactOptOutState', () => {
  it('shows a webhook unsubscribe as opted out even with no dnd flag, and locked', async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'unsubscribe', source: 'sendgrid' });
    const optOuts = await loadContactOptOutState({ accountKey: 'rooftopA', email: 'a@x.com', phone: null, dnd: null });
    expect(optOuts.email).toMatchObject({ optedOut: true, flag: false, lockedBy: 'unsubscribed' });
    expect(optOuts.sms).toMatchObject({ optedOut: false, lockedBy: null });
  });

  it("shows a staff opt-out as on and not locked", async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'a@x.com', reason: 'manual', source: 'manual' });
    const optOuts = await loadContactOptOutState({ accountKey: 'rooftopA', email: 'a@x.com', phone: null, dnd: null });
    expect(optOuts.email).toMatchObject({ optedOut: true, lockedBy: null });
  });

  it('only counts rows at the contact’s own account', async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopB', email: 'a@x.com', reason: 'bounce', source: 'sendgrid' });
    const optOuts = await loadContactOptOutState({ accountKey: 'rooftopA', email: 'a@x.com', phone: null, dnd: null });
    expect(optOuts.email.optedOut).toBe(false);
  });

  it('finds rows for a mixed-case contact address under either spelling', async () => {
    state.db.emailSuppression.seed({ accountKey: 'rooftopA', email: 'jane@x.com', reason: 'bounce', source: 'sendgrid' });
    const optOuts = await loadContactOptOutState({ accountKey: 'rooftopA', email: 'Jane@X.com', phone: null, dnd: null });
    expect(optOuts.email).toMatchObject({ optedOut: true, lockedBy: 'bounced' });
  });

  it('reads a STOP reply for the contact’s phone', async () => {
    state.db.smsSuppression.seed({ accountKey: 'rooftopA', phone: '+18015550134', reason: 'stop', source: 'twilio' });
    const optOuts = await loadContactOptOutState({
      accountKey: 'rooftopA',
      email: null,
      phone: '+18015550134',
      dnd: { sms: false },
    });
    expect(optOuts.sms).toMatchObject({ optedOut: true, flag: false, lockedBy: 'unsubscribed' });
  });
});

describe('parseOptOutList', () => {
  it('reads a pasted list, one per line or comma-separated', () => {
    const parsed = parseOptOutList(
      ['Jane@X.com', '(801) 555-0134', 'bob@y.com, 801.555.0199', 'jane@x.com', 'not an address', '555-01'].join('\n'),
    );
    expect(parsed.hasHeader).toBe(false);
    expect(parsed.emails).toEqual(['jane@x.com', 'bob@y.com']);
    expect(parsed.phones).toEqual(['+18015550134', '+18015550199']);
    expect(parsed.invalidCount).toBe(2);
    expect(parsed.invalidSamples).toEqual(['not an address', '555-01']);
  });

  it('pulls the address out of "Name <address>"', () => {
    expect(parseOptOutList('Jane Doe <jane@x.com>').emails).toEqual(['jane@x.com']);
  });

  it('tolerates a byte-order mark and blank lines', () => {
    expect(parseOptOutList('﻿a@x.com\n\n\nb@x.com\n').emails).toEqual(['a@x.com', 'b@x.com']);
  });

  it('returns nothing for nothing', () => {
    expect(parseOptOutList('   ')).toMatchObject({ emails: [], phones: [], invalidCount: 0, rowCount: 0 });
  });

  it('reads the address columns of an export with no opt-out columns: every row opts out', () => {
    const csv = ['First Name,Email,Phone', 'Jane,jane@x.com,(801) 555-0134', 'Bob,bob@,801-555-0199'].join('\n');
    const parsed = parseOptOutList(csv);
    expect(parsed.hasHeader).toBe(true);
    expect(parsed.emails).toEqual(['jane@x.com']);
    expect(parsed.phones).toEqual(['+18015550134', '+18015550199']);
    // "bob@" is a failed address; "Jane"/"Bob" in First Name are not addresses at all.
    expect(parsed.invalidCount).toBe(1);
  });

  it('lets the DND columns of a full export decide who opted out of what', () => {
    // A GoHighLevel-style export of EVERYONE: uploading it must suppress the
    // people marked DND, not the whole list.
    const csv = [
      'Contact Id,Email,Phone,DND,Email DND,SMS DND',
      'c1,all@x.com,8015550101,true,,',
      'c2,mailonly@x.com,8015550102,false,Yes,',
      'c3,textonly@x.com,8015550103,,,active',
      'c4,nobody@x.com,8015550104,false,no,inactive',
      'c5,also-nobody@x.com,8015550105,,,',
    ].join('\n');
    const parsed = parseOptOutList(csv);
    expect(parsed.optOutColumns).toEqual(['DND', 'Email DND', 'SMS DND']);
    expect(parsed.emails.sort()).toEqual(['all@x.com', 'mailonly@x.com']);
    expect(parsed.phones.sort()).toEqual(['+18015550101', '+18015550103']);
    expect(parsed.notOptedOutRows).toBe(2);
    expect(parsed.rowCount).toBe(5);
  });

  it("doesn't count a flag column's true/false as failed addresses", () => {
    const csv = ['Email,Email Opt In', 'a@x.com,true', 'b@x.com,false'].join('\n');
    const parsed = parseOptOutList(csv);
    expect(parsed.emails).toEqual(['a@x.com', 'b@x.com']);
    expect(parsed.invalidCount).toBe(0);
  });

  it('reads every column by content when no header names an address', () => {
    const csv = ['Who,Contact', 'Jane,jane@x.com', 'Bob,(801) 555-0134'].join('\n');
    const parsed = parseOptOutList(csv);
    expect(parsed.emails).toEqual(['jane@x.com']);
    expect(parsed.phones).toEqual(['+18015550134']);
    expect(parsed.invalidCount).toBe(0);
  });
});
