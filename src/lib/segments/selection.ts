// The audience selection a blast draft carries, and how to read one off
// a draft row. Client-safe on purpose — the schedule steps import it, so
// it must not pull in Prisma.
//
// A draft stores its audience in one of three mutually-exclusive columns
// (sourceContactIds / sourceListId / sourceFilter), with "no column set"
// meaning the whole account. The precedence below matches what the
// recipients step enforces when persisting; it's restated here so a stale
// field left over from a different mode can't leak into the send.

import type { FilterDefinition } from '@/lib/smart-list-types';

export type AudienceSelection =
  | { kind: 'all' }
  | { kind: 'list'; listId: string }
  | { kind: 'contacts'; ids: string[] }
  | { kind: 'filter'; definition: FilterDefinition };

/** One resolved, deliverable recipient. */
export interface RecipientRow {
  contactId: string;
  accountKey: string;
  email: string;
  fullName: string;
  phone: string;
}

export interface AudienceDraftFields {
  sourceContactIds?: string | null;
  sourceListId?: string | null;
  sourceFilter?: string | null;
}

/**
 * Read a draft's audience selection. Returns null when there's no draft
 * to read — callers treat that as "nothing to resolve yet" rather than
 * as "everyone".
 */
export function audienceSelectionFromDraft(
  draft: AudienceDraftFields | null | undefined,
): AudienceSelection | null {
  if (!draft) return null;

  if (draft.sourceContactIds) {
    let ids: string[] = [];
    try {
      const parsed = JSON.parse(draft.sourceContactIds);
      if (Array.isArray(parsed)) {
        ids = parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      ids = [];
    }
    return { kind: 'contacts', ids };
  }

  if (draft.sourceListId) {
    return { kind: 'list', listId: draft.sourceListId };
  }

  if (draft.sourceFilter) {
    try {
      const parsed = JSON.parse(draft.sourceFilter) as FilterDefinition;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.groups)) {
        return { kind: 'filter', definition: parsed };
      }
    } catch {
      // Unparseable filter — fall through. Deliberately NOT treated as
      // "everyone": a corrupt filter must never widen an audience.
    }
    return { kind: 'contacts', ids: [] };
  }

  return { kind: 'all' };
}
