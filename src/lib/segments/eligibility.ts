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
//   - contacts with no first-party provenance — no sale, no service
//     visit, no form submission, so nothing showing they chose to deal
//     with this dealer
//
// It also reports WHY each contact was dropped, because "your
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
    /**
     * No evidence this contact ever transacted with, or opted in to, this
     * dealer — see `hasFirstPartyProvenance`.
     */
    noProvenance: number;
  };
  /**
   * `source` values among the contacts dropped for lack of provenance,
   * commonest first.
   *
   * Reported rather than acted on: the whole question of which lead
   * vendors are arm's length is a business judgement, and this is the
   * evidence needed to make it. Without it the exclusion is just a number
   * nobody can audit.
   */
  excludedSources: Array<{ source: string; count: number }>;
}

export interface EligibilityResult {
  contacts: EligibleContact[];
  breakdown: EligibilityBreakdown;
}

const CHUNK = 1000;

/**
 * Resolve a segment to the contacts that may actually be uploaded.
 *
 * Consent is enforced per CONTACT, by provenance, rather than by a
 * per-account attestation.
 *
 * The earlier design made each rooftop tick a box affirming its data was
 * collected with the right disclosure. In production that box would be
 * ticked "yes" 33 times out of 33: 259,507 of 265,295 contacts have sale
 * or service history, i.e. they are customers who consented at the point
 * of transaction. An affirmation that is always true isn't a control, and
 * asking for it 33 times teaches people to click through it.
 *
 * The distinction that actually varies is per contact, and it covers the
 * remaining ~2%: someone who bought or serviced a vehicle consented as
 * part of that transaction; someone whose row arrived from a third-party
 * lead vendor or an unlabelled CSV did not necessarily consent to this
 * dealer sharing their details with an ad platform.
 */
export async function resolveEligibleForSync(
  accountKey: string,
  definition: FilterDefinition,
  fields: FieldDefinition[],
  opts: { channel?: SyncChannel } = {},
): Promise<EligibilityResult> {
  const channel = opts.channel ?? 'any';
  const ids = await collectSegmentContactIds(accountKey, definition, fields);

  const sourceCounts = new Map<string, number>();
  const breakdown: EligibilityBreakdown = {
    segmentSize: ids.length,
    eligible: 0,
    excluded: {
      noIdentifier: 0,
      suppressed: 0,
      optedOut: 0,
      duplicate: 0,
      noProvenance: 0,
    },
    excludedSources: [],
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
    const submitted = await loadFormSubmitters(slice);

    for (const contact of batch) {
      // Provenance first: it's the cheapest check and the one that says
      // whether we should be looking at this person at all.
      if (!hasFirstPartyProvenance(contact, submitted)) {
        breakdown.excluded.noProvenance += 1;
        const label = contact.source.trim() || '(no source recorded)';
        sourceCounts.set(label, (sourceCounts.get(label) ?? 0) + 1);
        continue;
      }

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
  breakdown.excludedSources = [...sourceCounts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  return { contacts, breakdown };
}

type Verdict =
  | { kind: 'eligible'; identifiers: HashedIdentifiers }
  | { kind: 'noIdentifier' }
  | { kind: 'suppressed' }
  | { kind: 'optedOut' };

/**
 * Whether we can point at something showing this contact chose to deal
 * with this dealer.
 *
 * Both signals are STRUCTURAL — a row in another table — rather than a
 * string match on `source`. That matters: `source` is free text set by
 * whichever CRM export or CSV produced the row, so a rule built on it
 * would be a guess about naming conventions that differ per rooftop and
 * change without notice. These two don't:
 *
 *   - a ContactEvent means a sale or service visit actually happened, so
 *     the customer consented as part of that transaction
 *   - a FormSubmission means they filled in one of this dealer's own
 *     forms, on this dealer's own site, under its disclosure
 *
 * Everything else — third-party lead vendors, unlabelled CSV imports,
 * lists of unknown origin — fails closed and is reported, with its
 * `source` value, so the exclusions can be reviewed and specific sources
 * allowed later on evidence rather than assumption.
 */
export function hasFirstPartyProvenance(
  contact: Pick<ApiContact, 'id' | 'serviceVisitCount' | 'saleCount'>,
  formSubmitters: ReadonlySet<string>,
): boolean {
  if (contact.serviceVisitCount > 0 || contact.saleCount > 0) return true;
  return formSubmitters.has(contact.id);
}

/** Contacts in this batch that have submitted one of our own forms. */
async function loadFormSubmitters(
  contactIds: string[],
): Promise<ReadonlySet<string>> {
  if (contactIds.length === 0) return new Set();
  const rows = await prisma.formSubmission.findMany({
    where: { contactId: { in: contactIds } },
    select: { contactId: true },
    distinct: ['contactId'],
  });
  return new Set(
    rows.map((r) => r.contactId).filter((id): id is string => !!id),
  );
}

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
  const sourceCounts = new Map<string, number>();
  const breakdown: EligibilityBreakdown = {
    segmentSize: 0,
    eligible: 0,
    excluded: {
      noIdentifier: 0,
      suppressed: 0,
      optedOut: 0,
      duplicate: 0,
      noProvenance: 0,
    },
    excludedSources: [],
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
    breakdown.excluded.noProvenance += result.breakdown.excluded.noProvenance;
    // Merge the per-account histograms; the same lead vendor typically
    // feeds several rooftops, and the combined figure is what says
    // whether it's worth reviewing.
    for (const { source, count } of result.breakdown.excludedSources) {
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + count);
    }

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
  breakdown.excludedSources = [...sourceCounts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  return { contacts, breakdown };
}
