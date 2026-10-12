// What POST /api/segments/recipients may hand back.
//
// Every caller of that route wants a COUNT — the Recipients step's "sendable
// recipients" number. Once the 5,000 ceiling came off, each click on an
// audience card downloaded the whole matching roster — names, email addresses
// and phone numbers, ~40k rows on a large account — to anyone with
// studio.segments.edit, a permission that does not include exporting contact
// PII (contacts.pii.export). So the route now returns the count alone, and a
// caller that genuinely wants to show who's in an audience can ask for a small
// sample of ids and names. Never addresses or numbers.

/** The most rows a caller can sample. */
export const AUDIENCE_SAMPLE_MAX = 50;

/** Rows to include: 0 (count only) unless a positive `limit` was sent. */
export function requestedSampleSize(limit: unknown): number {
  const n = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(AUDIENCE_SAMPLE_MAX, Math.floor(n));
}

export interface AudienceSampleRow {
  contactId: string;
  fullName: string;
}

export type AudienceCountResponse =
  | { total: number }
  | { total: number; truncated: boolean; sample: AudienceSampleRow[] };

/**
 * Project a resolved audience into the response. Built field by field rather
 * than by deleting keys, so a contact field added upstream stays out until
 * someone deliberately adds it here.
 */
export function projectAudienceCount(
  resolved: { total: number; recipients: { contactId: string; fullName: string }[] },
  sampleSize: number,
): AudienceCountResponse {
  if (sampleSize <= 0) return { total: resolved.total };
  return {
    total: resolved.total,
    truncated: resolved.total > sampleSize,
    sample: resolved.recipients.slice(0, sampleSize).map((row) => ({
      contactId: row.contactId,
      fullName: row.fullName,
    })),
  };
}
