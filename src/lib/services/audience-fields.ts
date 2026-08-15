// The field catalogue a saved segment is validated against.
//
// Mirrors what the builder UI shows (see segment-editor.tsx): inside a
// sub-account you get built-ins + that account's declared custom fields;
// org-wide you get built-ins only, because a custom-field key means
// different things in different sub-accounts.
//
// Kept as its own module so the API routes don't have to reach into the
// flows service (which is where the equivalent helper currently lives,
// private) and so the Phase 1 SQL resolver has one obvious place to
// share.

import { prisma } from '@/lib/prisma';
import { listFieldsForAccount } from '@/lib/services/contact-custom-fields';
import { getFilterableFields, type FieldDefinition } from '@/lib/smart-list-types';

export async function resolveFilterFields(
  accountKey: string | null | undefined,
  /** Excluded from the `segmentRef` options so a segment can't be made
   *  to reference itself from the builder. */
  excludeSegmentId?: string | null,
): Promise<FieldDefinition[]> {
  if (!accountKey) return getFilterableFields(null);
  const [custom, lists, segments] = await Promise.all([
    listFieldsForAccount(accountKey),
    // Populates the options on the `listIds` field so a saved segment
    // referencing a list validates, and so the builder can show names
    // instead of cuids.
    prisma.contactList.findMany({
      where: { accountKey },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    // Segments referenceable from this account: its own plus org-wide.
    prisma.audience.findMany({
      where: {
        OR: [{ accountKey }, { accountKey: null }],
        ...(excludeSegmentId ? { NOT: { id: excludeSegmentId } } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return getFilterableFields(
    custom.map((cf) => ({
      key: cf.key,
      label: cf.label,
      type: cf.type,
      category: cf.category,
      options: cf.options,
    })),
    lists,
    segments,
  );
}
