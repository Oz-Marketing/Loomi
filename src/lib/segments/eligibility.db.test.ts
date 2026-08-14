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
import {
  ConsentNotRecordedError,
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

/** Everyone in the account — the gate is what we're testing, not the filter. */
const ALL: FilterDefinition = {
  version: 1,
  logic: 'AND',
  groups: [
    {
      id: 'g',
      logic: 'AND',
      conditions: [
        { id: 'c', field: 'email', operator: 'is_not_empty' as FilterOperator, value: '' },
      ],
    },
  ],
};

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
    await prisma.emailSuppression.deleteMany({ where: { accountKey: key } });
    await prisma.smsSuppression.deleteMany({ where: { accountKey: key } });
    await prisma.contact.deleteMany({ where: { accountKey: key } });
    await prisma.account.deleteMany({ where: { key } });
  }
}

describe.skipIf(!RUN)('audience export eligibility gate', () => {
  beforeAll(async () => {
    await reset();

    await prisma.account.create({
      data: {
        key: A,
        dealer: 'Vitest Eligibility A',
        audienceSyncConsentBasis: 'first_party_disclosure',
        audienceSyncConsentAt: new Date(),
      },
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
      ],
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

  it('refuses outright when the account has no consent basis', async () => {
    await prisma.account.create({
      data: { key: B, dealer: 'Vitest Eligibility B' },
    });
    await prisma.contact.create({
      data: { accountKey: B, email: 'someone@example.com' },
    });

    // Hard stop, not a warning and not an empty result — an empty result
    // would read as "nobody qualified" rather than "you may not do this".
    await expect(resolveEligibleForSync(B, ALL, fields)).rejects.toThrow(
      ConsentNotRecordedError,
    );
  });

  it('de-duplicates the same person across accounts', async () => {
    // Same human, two rooftops, two Contact rows.
    await prisma.account.update({
      where: { key: B },
      data: {
        audienceSyncConsentBasis: 'first_party_disclosure',
        audienceSyncConsentAt: new Date(),
      },
    });
    await prisma.contact.create({
      data: { accountKey: B, email: 'clean@example.com', firstName: 'Cleo' },
    });

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

  it('fails the whole union when one account lacks consent', async () => {
    await prisma.account.update({
      where: { key: B },
      data: { audienceSyncConsentBasis: null, audienceSyncConsentAt: null },
    });

    // Skipping the non-consenting account silently would produce a
    // plausible-looking audience missing a rooftop, which is worse than
    // an error.
    await expect(
      resolveEligibleAcrossAccounts([A, B], ANY_CONTACT, new Map([[A, fields], [B, fields]])),
    ).rejects.toThrow(ConsentNotRecordedError);
  });
});
