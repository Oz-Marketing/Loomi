// The gate every audience export passes through.
//
// A segment answers "who matches these conditions". That is NOT the same
// question as "who may we upload to an ad platform", and conflating them
// is how unsubscribed people end up in a retargeting audience.
//
// The distinction matters because an export is not a send. Loomi's
// email and SMS paths already drop suppressed and opted-out contacts at
// send time, so a segment containing them is harmless there. Push that
// same segment to Google and none of those checks run — the contact
// leaves the building.
//
// So the gate here is UNCONDITIONAL. It is not a filter the user adds,
// not a checkbox they tick, and not a warning they can click past:
// every export path calls this, and it removes
//
//   - contacts with no usable identifier (nothing to match on)
//   - contacts on the account's email/SMS suppression list
//     (bounced, complained, or unsubscribed)
//   - contacts who opted out via the `dnd` flags
//
// …and refuses entirely for an account that hasn't recorded a consent
// basis. It also reports WHY each contact was dropped, because "your
// 40,000-person segment is a 12,000-person audience" is information the
// person building the campaign needs before they build it, not after.

import { prisma } from '@/lib/prisma';
import { CONTACT_SELECT, serializeContact } from '@/lib/contacts/queries';
import type { Contact as ApiContact } from '@/lib/contacts/types';
import type { FieldDefinition, FilterDefinition } from '@/lib/smart-list-types';
import {
  hashContactIdentifiers,
  identityDedupeKey,
  type HashedIdentifiers,
} from './identity';
import { collectSegmentContactIds } from './resolve';

/** Which identifier the destination can actually match on. */
export type SyncChannel = 'email' | 'phone' | 'any';

export interface EligibleContact {
  contactId: string;
  accountKey: string;
  identifiers: HashedIdentifiers;
}

export interface EligibilityBreakdown {
  /** Members of the segment before any gate. */
  segmentSize: number;
  /** Uploadable after gating and de-duplication. */
  eligible: number;
  excluded: {
    noIdentifier: number;
    suppressed: number;
    optedOut: number;
    /** Same person appearing more than once (see identityDedupeKey). */
    duplicate: number;
  };
}

export interface EligibilityResult {
  contacts: EligibleContact[];
  breakdown: EligibilityBreakdown;
}

export class ConsentNotRecordedError extends Error {
  constructor(accountKey: string) {
    super(
      `Account ${accountKey} has not recorded a consent basis for audience sync. ` +
        'Record one before exporting contacts to an ad platform.',
    );
    this.name = 'ConsentNotRecordedError';
  }
}

const CHUNK = 1000;

/**
 * Resolve a segment to the contacts that may actually be uploaded.
 *
 * @throws ConsentNotRecordedError when the account has no attestation —
 *   a hard stop, on purpose.
 */
export async function resolveEligibleForSync(
  accountKey: string,
  definition: FilterDefinition,
  fields: FieldDefinition[],
  opts: { channel?: SyncChannel } = {},
): Promise<EligibilityResult> {
  await assertConsentRecorded(accountKey);

  const channel = opts.channel ?? 'any';
  const ids = await collectSegmentContactIds(accountKey, definition, fields);

  const breakdown: EligibilityBreakdown = {
    segmentSize: ids.length,
    eligible: 0,
    excluded: { noIdentifier: 0, suppressed: 0, optedOut: 0, duplicate: 0 },
  };
  if (ids.length === 0) return { contacts: [], breakdown };

  const seen = new Set<string>();
  const contacts: EligibleContact[] = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const rows = await prisma.contact.findMany({
      where: { accountKey, id: { in: slice } },
      select: CONTACT_SELECT,
    });
    const batch = rows.map(serializeContact);
    const suppressed = await loadSuppressed(accountKey, batch);

    for (const contact of batch) {
      const verdict = classify(contact, suppressed, channel);
      if (verdict.kind !== 'eligible') {
        breakdown.excluded[verdict.kind] += 1;
        continue;
      }

      // De-duplicate on hashed identity. Within one account this is
      // rare; it matters when several accounts are unioned into one
      // audience, where the same person legitimately has a row per
      // rooftop.
      const key = identityDedupeKey(verdict.identifiers);
      if (key && seen.has(key)) {
        breakdown.excluded.duplicate += 1;
        continue;
      }
      if (key) seen.add(key);

      contacts.push({
        contactId: contact.id,
        accountKey,
        identifiers: verdict.identifiers,
      });
    }
  }

  breakdown.eligible = contacts.length;
  return { contacts, breakdown };
}

type Verdict =
  | { kind: 'eligible'; identifiers: HashedIdentifiers }
  | { kind: 'noIdentifier' }
  | { kind: 'suppressed' }
  | { kind: 'optedOut' };

function classify(
  contact: ApiContact,
  suppressed: { emails: Set<string>; phones: Set<string> },
  channel: SyncChannel,
): Verdict {
  const email = contact.email.trim().toLowerCase();
  const phone = contact.phone.trim();

  // Opt-out and suppression are evaluated per channel, then combined:
  // a contact who unsubscribed from email but never opted out of SMS is
  // still reachable via phone, and dropping them entirely would
  // needlessly shrink the audience.
  const emailBlocked = contact.dndEmail || (!!email && suppressed.emails.has(email));
  const smsBlocked = contact.dndSms || (!!phone && suppressed.phones.has(phone));

  const usableEmail = !!email && !emailBlocked;
  const usablePhone = !!phone && !smsBlocked;

  const wanted =
    channel === 'email'
      ? { email: usableEmail, phone: false }
      : channel === 'phone'
        ? { email: false, phone: usablePhone }
        : { email: usableEmail, phone: usablePhone };

  if (!wanted.email && !wanted.phone) {
    // Distinguish "we were told not to" from "there was nothing to send
    // to" — they call for completely different fixes.
    const hadSomething =
      (channel !== 'phone' && !!email) || (channel !== 'email' && !!phone);
    if (!hadSomething) return { kind: 'noIdentifier' };
    const optedOut =
      (channel !== 'phone' && !!email && contact.dndEmail) ||
      (channel !== 'email' && !!phone && contact.dndSms);
    return optedOut ? { kind: 'optedOut' } : { kind: 'suppressed' };
  }

  const identifiers = hashContactIdentifiers({
    email: wanted.email ? email : null,
    phone: wanted.phone ? phone : null,
    firstName: contact.firstName,
    lastName: contact.lastName,
    postalCode: contact.postalCode,
    country: contact.country,
  });

  // The address block alone isn't enough: it's a supplementary matching
  // signal, and an "audience" of nothing but hashed names would match
  // almost nobody while looking like a real upload. Reaching here means
  // the contact had an email or phone that normalisation rejected — a
  // 7-digit number with no country code, say.
  if (!identifiers.hashedEmail && !identifiers.hashedPhone) {
    return { kind: 'noIdentifier' };
  }

  return { kind: 'eligible', identifiers };
}

/** Suppression entries covering this batch, as lookup sets. */
async function loadSuppressed(
  accountKey: string,
  batch: ApiContact[],
): Promise<{ emails: Set<string>; phones: Set<string> }> {
  const emails = batch.map((c) => c.email.trim().toLowerCase()).filter(Boolean);
  const phones = batch.map((c) => c.phone.trim()).filter(Boolean);

  const [emailRows, phoneRows] = await Promise.all([
    emails.length
      ? prisma.emailSuppression.findMany({
          where: { accountKey, email: { in: emails } },
          select: { email: true },
        })
      : Promise.resolve([]),
    phones.length
      ? prisma.smsSuppression.findMany({
          where: { accountKey, phone: { in: phones } },
          select: { phone: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    emails: new Set(emailRows.map((r) => r.email.trim().toLowerCase())),
    phones: new Set(phoneRows.map((r) => r.phone.trim())),
  };
}

async function assertConsentRecorded(accountKey: string): Promise<void> {
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { audienceSyncConsentBasis: true, audienceSyncConsentAt: true },
  });
  if (!account?.audienceSyncConsentBasis || !account.audienceSyncConsentAt) {
    throw new ConsentNotRecordedError(accountKey);
  }
}

/**
 * Union several accounts' eligible contacts into one audience,
 * de-duplicating across them.
 *
 * This is what makes an org-level audience honest. Contacts are unique
 * per (accountKey, email), so a customer who has shopped at three Young
 * rooftops is three rows; uploading all three inflates the reported
 * audience size, burns match quota, and defeats frequency capping —
 * the platform sees one person but has been told about three.
 *
 * Each account is still gated independently, so one rooftop without a
 * recorded consent basis fails the whole export rather than being
 * quietly skipped.
 */
export async function resolveEligibleAcrossAccounts(
  accountKeys: string[],
  definition: FilterDefinition,
  fieldsByAccount: Map<string, FieldDefinition[]>,
  opts: { channel?: SyncChannel } = {},
): Promise<EligibilityResult> {
  const seen = new Set<string>();
  const contacts: EligibleContact[] = [];
  const breakdown: EligibilityBreakdown = {
    segmentSize: 0,
    eligible: 0,
    excluded: { noIdentifier: 0, suppressed: 0, optedOut: 0, duplicate: 0 },
  };

  for (const accountKey of accountKeys) {
    const fields = fieldsByAccount.get(accountKey);
    if (!fields) continue;
    const result = await resolveEligibleForSync(accountKey, definition, fields, opts);

    breakdown.segmentSize += result.breakdown.segmentSize;
    breakdown.excluded.noIdentifier += result.breakdown.excluded.noIdentifier;
    breakdown.excluded.suppressed += result.breakdown.excluded.suppressed;
    breakdown.excluded.optedOut += result.breakdown.excluded.optedOut;
    breakdown.excluded.duplicate += result.breakdown.excluded.duplicate;

    for (const contact of result.contacts) {
      const key = identityDedupeKey(contact.identifiers);
      if (key && seen.has(key)) {
        breakdown.excluded.duplicate += 1;
        continue;
      }
      if (key) seen.add(key);
      contacts.push(contact);
    }
  }

  breakdown.eligible = contacts.length;
  return { contacts, breakdown };
}
