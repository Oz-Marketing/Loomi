// DB-backed tests for the audience-export eligibility gate.
//
// This is the code standing between "we hold this person's email" and
// "we uploaded this person's email to Google", so the tests are written
// as assertions about who must NOT come out the other side. A false
// negative here is a smaller audience; a false positive is an
// unsubscribed customer in a retargeting pool.
//
// Self-skips unless RUN_DB_TESTS=1.  Run with:  RUN_DB_TESTS=1 npm test
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { recomputeContactEventRollups } from '@/lib/contacts/event-rollups';
import {
  resolveEligibleAcrossAccounts,
  resolveEligibleForSync,
} from './eligibility';
import { sha256Hex } from './identity';
import {
  getFilterableFields,
  type FilterDefinition,
  type FilterOperator,
} from '@/lib/smart-list-types';

const RUN = !!process.env.RUN_DB_TESTS;
const A = '__vitest_elig_a';
const B = '__vitest_elig_b';
const fields = getFilterableFields(null);

/** Matches contacts with either identifier, so phone-only rows count. */
const ANY_CONTACT: FilterDefinition = {
  version: 1,
  logic: 'OR',
  groups: [
    { id: 'g1', logic: 'AND', conditions: [{ id: 'a', field: 'email', operator: 'is_not_empty' as FilterOperator, value: '' }] },
    { id: 'g2', logic: 'AND', conditions: [{ id: 'b', field: 'phone', operator: 'is_not_empty' as FilterOperator, value: '' }] },
  ],
};

async function reset() {
  for (const key of [A, B]) {
    await prisma.formSubmission.deleteMany({ where: { form: { accountKey: key } } });
    await prisma.form.deleteMany({ where: { accountKey: key } });
    await prisma.emailSuppression.deleteMany({ where: { accountKey: key } });
    await prisma.smsSuppression.deleteMany({ where: { accountKey: key } });
    await prisma.contactEvent.deleteMany({ where: { accountKey: key } });
    await prisma.contact.deleteMany({ where: { accountKey: key } });
    await prisma.account.deleteMany({ where: { key } });
  }
}

/** Give a contact a service visit, so it clears the provenance gate.
 *  Most cases here are testing the suppression/opt-out rules, not
 *  provenance, and would otherwise be excluded before reaching them. */
async function giveTransaction(accountKey: string, email: string) {
  const c = await prisma.contact.findFirst({
    where: { accountKey, email },
    select: { id: true },
  });
  if (!c) throw new Error(`no contact ${email}`);
  await prisma.contactEvent.create({
    data: {
      accountKey,
      contactId: c.id,
      type: 'service',
      eventDate: new Date(),
      amount: 100,
      idempotencyKey: `__vitest:elig:${accountKey}:${email}`,
    },
  });
  await recomputeContactEventRollups(accountKey, [c.id]);
}

describe.skipIf(!RUN)('audience export eligibility gate', () => {
  beforeAll(async () => {
    await reset();

    await prisma.account.create({
      data: { key: A, dealer: 'Vitest Eligibility A' },
    });

    await prisma.contact.createMany({
      data: [
        // Clean, uploadable.
        { accountKey: A, email: 'clean@example.com', phone: '+12125550101', firstName: 'Cleo', lastName: 'Clean', postalCode: '84401', country: 'US' },
        // Opted out of email via dnd.
        { accountKey: A, email: 'optout@example.com', dnd: { email: true } },
        // On the email suppression list (unsubscribed / bounced).
        { accountKey: A, email: 'suppressed@example.com' },
        // No usable identifier: phone too short to carry a country code.
        { accountKey: A, phone: '5550123' },
        // Reachable by phone only — email opted out, SMS fine.
        { accountKey: A, email: 'mixed@example.com', phone: '+12125550102', dnd: { email: true } },
        // No transaction, no form submission — a bought lead list.
        { accountKey: A, email: 'coldlead@example.com', source: 'AutoLeads Inc' },
        // Same, so the source histogram has something to rank.
        { accountKey: A, email: 'coldlead2@example.com', source: 'AutoLeads Inc' },
        // Never transacted, but filled in one of OUR forms.
        { accountKey: A, email: 'formfill@example.com' },
      ],
    });

    // Everything that should survive the gate needs provenance.
    for (const email of [
      'clean@example.com',
      'optout@example.com',
      'suppressed@example.com',
      'mixed@example.com',
    ]) {
      await giveTransaction(A, email);
    }
    // …and the phone-only row, addressed by phone since it has no email.
    const phoneOnly = await prisma.contact.findFirst({
      where: { accountKey: A, phone: '5550123' },
      select: { id: true },
    });
    await prisma.contactEvent.create({
      data: {
        accountKey: A,
        contactId: phoneOnly!.id,
        type: 'service',
        eventDate: new Date(),
        idempotencyKey: `__vitest:elig:${A}:phoneonly`,
      },
    });
    await recomputeContactEventRollups(A, [phoneOnly!.id]);

    // A form submission is the other first-party signal.
    const form = await prisma.form.create({
      data: {
        accountKey: A,
        name: 'Vitest Form',
        slug: `__vitest-elig-${Date.now()}`,
        schema: {},
      },
      select: { id: true },
    });
    const filler = await prisma.contact.findFirst({
      where: { accountKey: A, email: 'formfill@example.com' },
      select: { id: true },
    });
    await prisma.formSubmission.create({
      data: { formId: form.id, contactId: filler!.id, data: {} },
    });

    await prisma.emailSuppression.create({
      data: { accountKey: A, email: 'suppressed@example.com', reason: 'unsubscribe' },
    });
  });

  afterAll(reset);

  it('excludes opted-out, suppressed and unidentifiable contacts', async () => {
    const { contacts, breakdown } = await resolveEligibleForSync(A, ANY_CONTACT, fields);
    const emails = contacts.map((c) => c.identifiers.hashedEmail);

    // The clean contact is in.
    expect(emails).toContain(sha256Hex('clean@example.com'));
    // The opted-out and suppressed ones are NOT — by hash, since that's
    // what would actually be uploaded.
    expect(emails).not.toContain(sha256Hex('optout@example.com'));
    expect(emails).not.toContain(sha256Hex('suppressed@example.com'));

    expect(breakdown.excluded.optedOut).toBeGreaterThan(0);
    expect(breakdown.excluded.suppressed).toBeGreaterThan(0);
    expect(breakdown.excluded.noIdentifier).toBeGreaterThan(0);
    expect(breakdown.eligible).toBeLessThan(breakdown.segmentSize);
  });

  it('keeps a contact reachable on one channel when the other is blocked', async () => {
    const { contacts } = await resolveEligibleForSync(A, ANY_CONTACT, fields);
    const mixed = contacts.find(
      (c) => c.identifiers.hashedPhone === sha256Hex('12125550102'),
    );
    // Email opted out, so no email identifier — but still uploadable.
    expect(mixed).toBeDefined();
    expect(mixed!.identifiers.hashedEmail).toBeNull();
  });

  it('honours the requested channel', async () => {
    const emailOnly = await resolveEligibleForSync(A, ANY_CONTACT, fields, {
      channel: 'email',
    });
    for (const contact of emailOnly.contacts) {
      expect(contact.identifiers.hashedPhone).toBeNull();
      expect(contact.identifiers.hashedEmail).not.toBeNull();
    }
    // The phone-only-reachable contact drops out entirely.
    expect(emailOnly.breakdown.eligible).toBeLessThan(
      (await resolveEligibleForSync(A, ANY_CONTACT, fields)).breakdown.eligible,
    );
  });

  it('never emits a hash of an empty string', async () => {
    const { contacts } = await resolveEligibleForSync(A, ANY_CONTACT, fields);
    const emptyHash = sha256Hex('');
    for (const contact of contacts) {
      expect(contact.identifiers.hashedEmail).not.toBe(emptyHash);
      expect(contact.identifiers.hashedPhone).not.toBe(emptyHash);
    }
  });

  it('excludes contacts with no first-party provenance', async () => {
    const { contacts, breakdown } = await resolveEligibleForSync(A, ANY_CONTACT, fields);

    // The two bought leads never transacted and never filled in a form.
    expect(breakdown.excluded.noProvenance).toBe(2);
    const emails = contacts.map((c) => c.identifiers.hashedEmail);
    expect(emails).not.toContain(sha256Hex('coldlead@example.com'));
    expect(emails).not.toContain(sha256Hex('coldlead2@example.com'));
  });

  it('accepts a form submission as provenance, with no transaction', async () => {
    // Someone who filled in the dealer's own form, under its own
    // disclosure, is first-party even though they never bought anything.
    const { contacts } = await resolveEligibleForSync(A, ANY_CONTACT, fields);
    expect(contacts.map((c) => c.identifiers.hashedEmail)).toContain(
      sha256Hex('formfill@example.com'),
    );
  });

  it('reports which sources were dropped, so they can be reviewed', async () => {
    const { breakdown } = await resolveEligibleForSync(A, ANY_CONTACT, fields);

    // The number alone isn't auditable — the point is being able to see
    // WHICH vendor the excluded rows came from.
    expect(breakdown.excludedSources[0]).toEqual({
      source: 'AutoLeads Inc',
      count: 2,
    });
  });

  it('de-duplicates the same person across accounts', async () => {
    // Same human, two rooftops, two Contact rows.
    await prisma.account.create({
      data: { key: B, dealer: 'Vitest Eligibility B' },
    });
    const dup = await prisma.contact.create({
      data: { accountKey: B, email: 'clean@example.com', firstName: 'Cleo' },
      select: { id: true },
    });
    await prisma.contactEvent.create({
      data: {
        accountKey: B,
        contactId: dup.id,
        type: 'sale',
        eventDate: new Date(),
        amount: 20000,
        idempotencyKey: `__vitest:elig:${B}:dup`,
      },
    });
    await recomputeContactEventRollups(B, [dup.id]);

    const fieldsByAccount = new Map([
      [A, fields],
      [B, fields],
    ]);
    const union = await resolveEligibleAcrossAccounts(
      [A, B],
      ANY_CONTACT,
      fieldsByAccount,
    );

    const cleanHash = sha256Hex('clean@example.com');
    const occurrences = union.contacts.filter(
      (c) => c.identifiers.hashedEmail === cleanHash,
    );
    expect(occurrences).toHaveLength(1);
    expect(union.breakdown.excluded.duplicate).toBeGreaterThan(0);
  });

  it('aggregates provenance exclusions across accounts', async () => {
    const noProv = await prisma.contact.create({
      data: { accountKey: B, email: 'coldB@example.com', source: 'AutoLeads Inc' },
      select: { id: true },
    });
    expect(noProv.id).toBeTruthy();

    const union = await resolveEligibleAcrossAccounts(
      [A, B],
      ANY_CONTACT,
      new Map([[A, fields], [B, fields]]),
    );

    // Both rooftops buy from the same vendor; the merged histogram is
    // what shows it's worth a conversation.
    expect(union.breakdown.excluded.noProvenance).toBe(3);
    expect(union.breakdown.excludedSources[0]).toEqual({
      source: 'AutoLeads Inc',
      count: 3,
    });
  });
});
