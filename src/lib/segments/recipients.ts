// Server-side recipient resolution for blasts.
//
// WHY THIS EXISTS: the blast schedule pages used to build their recipient
// list in the browser from `/api/contacts?all=true`, which returns the
// 5,000 most-recently-added contacts. The segment filter was then applied
// to THAT slice.
//
// The ordering is the bug. There is a deliberate 5,000-recipient ceiling
// per campaign (see the schedule routes), so a large audience being
// capped is by design — but the cap was landing BEFORE the filter instead
// of after it. For any segment that doesn't correlate with recency —
// "purchased more than 2 years ago", "lapsed service", "lease ending" —
// the campaign reached only those members who happened to fall inside the
// newest 5,000 rows. That can be a small and essentially arbitrary
// fraction of the real segment, and nothing in the UI said so: the
// campaign reported sending to its full (truncated) list.
//
// Resolving here fixes the ordering — filter the whole roster, then apply
// the ceiling — and, when the audience genuinely exceeds the ceiling,
// reports it so the caller can refuse rather than quietly send to a
// subset.

import { prisma } from '@/lib/prisma';
import { CONTACT_SELECT, serializeContact } from '@/lib/contacts/queries';
import {
  isLikelyDialablePhone,
  normalizePhoneNumber,
} from '@/lib/contact-hygiene';
import type { Contact as ApiContact } from '@/lib/contacts/types';
import type { FieldDefinition } from '@/lib/smart-list-types';
import { collectSegmentContactIds } from './resolve';
import type { AudienceSelection, RecipientRow } from './selection';

export type { AudienceSelection, RecipientRow };

export interface ResolvedRecipients {
  recipients: RecipientRow[];
  /** Deliverable members of the audience, BEFORE the campaign ceiling. */
  total: number;
  /** True when `total` exceeded `limit` and `recipients` is a prefix. */
  truncated: boolean;
}

// Kept byte-identical to the predicate the schedule pages applied
// client-side, so moving resolution to the server changes WHICH contacts
// are considered (the whole roster, not the newest 5,000) without also
// changing what counts as a deliverable address.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

// The SMS steps gate on isLikelyDialablePhone(normalizePhoneNumber(…)),
// so use the same pair here rather than a lookalike regex — a recipient
// set that differs from the one the page would have produced is a
// behaviour change hiding inside a bug fix.
function isValidPhone(value: string): boolean {
  return isLikelyDialablePhone(normalizePhoneNumber(value));
}

export async function resolveRecipients(
  accountKey: string,
  selection: AudienceSelection,
  fields: FieldDefinition[],
  opts: { channel: 'email' | 'sms' | 'any'; limit: number },
): Promise<ResolvedRecipients> {
  const ids = await resolveAudienceIds(accountKey, selection, fields);

  // Nothing matched — return early rather than issuing an `IN ()` query.
  if (ids.length === 0) return { recipients: [], total: 0, truncated: false };

  const deliverable: RecipientRow[] = [];
  // Chunked so a large audience doesn't build one enormous IN clause.
  const CHUNK = 1000;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await prisma.contact.findMany({
      where: { accountKey, id: { in: ids.slice(i, i + CHUNK) } },
      select: CONTACT_SELECT,
    });
    for (const row of rows) {
      const contact = serializeContact(row);
      if (!isDeliverable(contact, opts.channel)) continue;
      deliverable.push({
        contactId: contact.id,
        accountKey,
        email: contact.email.trim(),
        fullName: contact.fullName.trim(),
        phone: normalizePhoneNumber(contact.phone),
      });
    }
  }

  return {
    recipients: deliverable.slice(0, opts.limit),
    total: deliverable.length,
    truncated: deliverable.length > opts.limit,
  };
}

function isDeliverable(contact: ApiContact, channel: 'email' | 'sms' | 'any'): boolean {
  if (!contact.id) return false;
  const email = isValidEmail(contact.email.trim());
  const phone = isValidPhone(contact.phone.trim());
  if (channel === 'email') return email;
  if (channel === 'sms') return phone;
  return email || phone;
}

async function resolveAudienceIds(
  accountKey: string,
  selection: AudienceSelection,
  fields: FieldDefinition[],
): Promise<string[]> {
  switch (selection.kind) {
    case 'all': {
      const rows = await prisma.contact.findMany({
        where: { accountKey },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }
    case 'list': {
      const rows = await prisma.contactListMembership.findMany({
        where: { listId: selection.listId, contact: { accountKey } },
        select: { contactId: true },
      });
      return rows.map((r) => r.contactId);
    }
    case 'contacts': {
      // Re-check account scope: the ids came from a client draft, and a
      // stale draft can carry contacts that have since moved or been
      // deleted.
      const rows = await prisma.contact.findMany({
        where: { accountKey, id: { in: selection.ids } },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }
    case 'filter':
      return collectSegmentContactIds(accountKey, selection.definition, fields);
  }
}
