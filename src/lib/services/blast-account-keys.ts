/**
 * The accounts a blast belongs to, as sent by a create or PATCH request.
 *
 * WHY A BLAST MUST NAME AN ACCOUNT. A blast saved with no account
 * (`accountKeys: []`) was treated by the Blasts list as belonging everywhere:
 * it showed in every account's list, so a blast made while a group was
 * selected turned up in the group AND in each of its rooftops — reading as
 * though every child had been handed a copy. Unassigned blasts date from the
 * retired agency scope; nothing legitimate creates one any more, so the API
 * refuses to, and the list no longer shows them.
 */

export const BLAST_ACCOUNT_REQUIRED =
  'Choose an account for this blast first — every blast belongs to one account.';

export type BlastAccountKeysResult =
  | { ok: true; keys: string[] }
  | { ok: false; error: string };

/** Non-empty, de-duplicated string keys; anything else is an error. */
export function parseBlastAccountKeys(raw: unknown): BlastAccountKeysResult {
  const keys = Array.isArray(raw)
    ? [...new Set(raw.filter((k): k is string => typeof k === 'string' && k.trim().length > 0))]
    : [];
  if (keys.length === 0) return { ok: false, error: BLAST_ACCOUNT_REQUIRED };
  return { ok: true, keys };
}
