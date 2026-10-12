import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, prismaFor, type FakeDb } from '@/lib/sending/__fixtures__/suppression-db';

// Bringing GoHighLevel opt-outs over through the ordinary contact import: a
// "DND" column used to land in customFields and change nothing. Now it sets
// the contact's dnd (never clearing one) and writes the suppression rows the
// send path enforces, for every account in the group.

const state: { db: FakeDb } = { db: createFakeDb() };
const related = new Map<string, string[]>();

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, prop) => Reflect.get(prismaFor(state.db), prop) }),
}));
vi.mock('@/lib/services/accounts', () => ({
  getRelatedAccountKeys: async (key: string) => related.get(key) ?? [],
}));
vi.mock('@/lib/services/contact-lists', () => ({
  addContactsToList: async (_listId: string, ids: string[]) => ids.length,
}));

const { importContacts, parseCsv } = await import('./import');

const CSV = [
  'Email,Phone,First Name,DND,Email DND,SMS DND',
  'new@x.com,(801) 555-0101,Nell,true,,',
  'kept@x.com,(801) 555-0102,Kip,false,no,',
  'mailonly@x.com,(801) 555-0103,Mo,,Yes,',
  'plain@x.com,(801) 555-0104,Pat,,,',
].join('\n');

function mapping() {
  return parseCsv(CSV).suggestedMapping;
}

beforeEach(() => {
  state.db = createFakeDb();
  related.clear();
  related.set('rooftopA', ['youngGroup']);
});

describe('importContacts with opt-out columns', () => {
  it('auto-maps the opt-out columns instead of filing them as custom fields', () => {
    expect(mapping()).toMatchObject({ DND: 'optout:all', 'Email DND': 'optout:email', 'SMS DND': 'optout:sms' });
  });

  it('writes the opt-outs to the suppression list for the group, as source "import"', async () => {
    const summary = await importContacts({
      accountKey: 'rooftopA',
      csvText: CSV,
      mapping: mapping(),
      importedBy: 'user_1',
    });

    expect(summary.optedOut).toEqual({ email: 2, sms: 1 });
    const imported = { reason: 'manual', source: 'import' };
    expect(state.db.emailSuppression.byAccount('new@x.com')).toEqual({ rooftopA: imported, youngGroup: imported });
    expect(state.db.emailSuppression.byAccount('mailonly@x.com')).toEqual({ rooftopA: imported, youngGroup: imported });
    expect(state.db.smsSuppression.byAccount('+18015550101')).toEqual({ rooftopA: imported, youngGroup: imported });
    // Rows that said "no", or nothing, write nothing.
    expect(state.db.emailSuppression.byAccount('kept@x.com')).toEqual({});
    expect(state.db.emailSuppression.byAccount('plain@x.com')).toEqual({});
    expect(state.db.smsSuppression.byAccount('+18015550103')).toEqual({});
    // Provenance for the audit trail.
    expect(JSON.parse(String(state.db.emailSuppression.rows[0].raw))).toEqual({
      via: 'contact-import',
      userId: 'user_1',
    });
  });

  it('flags new contacts and never clears an existing opt-out on a matched one', async () => {
    state.db.contact.seed({ id: 'kept', accountKey: 'rooftopA', email: 'kept@x.com', dnd: { email: true } });

    await importContacts({ accountKey: 'rooftopA', csvText: CSV, mapping: mapping() });

    const created = state.db.contact.rows.find((r) => r.email === 'new@x.com');
    expect(created?.dnd).toEqual({ email: true, sms: true });
    expect(state.db.contact.rows.find((r) => r.email === 'mailonly@x.com')?.dnd).toEqual({ email: true });
    // The file says "no" for kept@ — that's GHL's view, not a resubscribe.
    expect(state.db.contact.get('kept')?.dnd).toEqual({ email: true });
    // And no opt-out leaks into custom fields.
    expect(created?.customFields ?? null).toBeNull();
  });

  it('applies opt-outs even on a roster upload that leaves matched fields alone', async () => {
    state.db.contact.seed({ id: 'm1', accountKey: 'rooftopA', email: 'mailonly@x.com', firstName: 'Original' });

    await importContacts({
      accountKey: 'rooftopA',
      csvText: CSV,
      mapping: mapping(),
      preserveExistingOnMatch: true,
    });

    expect(state.db.contact.get('m1')).toMatchObject({ firstName: 'Original', dnd: { email: true } });
  });

  it('counts opt-outs on a dry run without writing anything', async () => {
    const summary = await importContacts({ accountKey: 'rooftopA', csvText: CSV, mapping: mapping(), dryRun: true });
    expect(summary.optedOut).toEqual({ email: 2, sms: 1 });
    expect(state.db.emailSuppression.rows).toHaveLength(0);
    expect(state.db.smsSuppression.rows).toHaveLength(0);
    expect(state.db.contact.rows).toHaveLength(0);
  });
});
