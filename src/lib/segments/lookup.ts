// "Which contacts are in this segment, across these accounts?" — the
// shared answer behind the Contacts page's segment filter and the
// segment CSV export.
//
// Both surfaces need the same three things and got them wrong in
// different ways before this existed: the saved segment resolved by id,
// the definition validated against the RIGHT field catalogue (which is
// per-account — custom field keys mean different things in different
// rooftops), and membership resolved server-side rather than by
// filtering whatever page the browser happened to be holding.
//
// A segment is a filter, not a member list, so "the segment" has a
// different answer in every account. Resolution is therefore per-account
// and then unioned; an org-wide segment viewed from a group rolls up the
// same way the counts do.

import { prisma } from '@/lib/prisma';
import { resolveFilterFields } from '@/lib/services/audience-fields';
import type { FilterDefinition } from '@/lib/smart-list-types';
import {
  formatFilterErrors,
  parseAndValidateFilterDefinition,
  validateFilterDefinition,
} from '@/lib/smart-list-validate';
import { collectSegmentContactIds } from './resolve';

/**
 * Ceiling on one resolution. Well above any real segment (the largest
 * account in production is a few hundred thousand contacts in total),
 * and here so a pathological filter can't turn a page render into an
 * unbounded id array held in memory. Exceeding it is an error rather
 * than a truncation — a silently shortened segment is the exact failure
 * this module replaced.
 */
export const MAX_SEGMENT_IDS = 200_000;

export class SegmentLookupError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'SegmentLookupError';
    this.status = status;
  }
}

export class SegmentTooLargeError extends SegmentLookupError {
  constructor() {
    super(
      `This filter matches more than ${MAX_SEGMENT_IDS.toLocaleString()} contacts — narrow it before viewing or exporting.`,
      507,
    );
    this.name = 'SegmentTooLargeError';
  }
}

export interface SegmentSource {
  /** A saved segment (Audience) id. */
  segmentId?: string | null;
  /** An unsaved definition straight from the filter builder. */
  definition?: unknown;
}

export interface ResolvedSegmentSource {
  /** Present only when the source was a saved segment. */
  segment: { id: string; name: string; accountKey: string | null } | null;
  /** Raw, unvalidated definition — validated per-account by the resolver. */
  definition: FilterDefinition;
}

/**
 * Turn a request's `{ segmentId }` or `{ definition }` into a definition,
 * checking that a saved segment is one the caller's accounts may see.
 *
 * Visibility mirrors `/api/segments/counts`: an org-wide segment (null
 * accountKey) is readable everywhere; a scoped one only from its own
 * account.
 */
export async function resolveSegmentSource(
  source: SegmentSource,
  allowedAccountKeys: string[],
): Promise<ResolvedSegmentSource> {
  const segmentId =
    typeof source.segmentId === 'string' && source.segmentId.trim()
      ? source.segmentId.trim()
      : null;

  if (segmentId) {
    const audience = await prisma.audience.findUnique({
      where: { id: segmentId },
      select: { id: true, name: true, accountKey: true, filters: true },
    });
    if (!audience) {
      throw new SegmentLookupError('Segment not found', 404);
    }
    if (audience.accountKey && !allowedAccountKeys.includes(audience.accountKey)) {
      throw new SegmentLookupError('Forbidden', 403);
    }
    let parsed: FilterDefinition;
    try {
      parsed = JSON.parse(audience.filters) as FilterDefinition;
    } catch {
      throw new SegmentLookupError('This segment has an unreadable filter');
    }
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.groups)) {
      throw new SegmentLookupError('This segment has an invalid filter');
    }
    return {
      segment: { id: audience.id, name: audience.name, accountKey: audience.accountKey },
      definition: parsed,
    };
  }

  const definition = source.definition as FilterDefinition | undefined;
  if (!definition || typeof definition !== 'object') {
    throw new SegmentLookupError('segmentId or definition is required');
  }
  return { segment: null, definition };
}

export interface SegmentMembership {
  /** Every matching contact id across the requested accounts, deduped. */
  ids: string[];
  /** Per-account counts, so a roll-up can say where the members are. */
  byAccount: Record<string, number>;
  /** Accounts whose resolution failed, with why. One bad rooftop should
   *  not blank the other seventeen. */
  errors: Array<{ accountKey: string; error: string }>;
}

/**
 * Resolve membership across accounts.
 *
 * Sequential on purpose. The scan strategy (see resolve.ts) walks an
 * account's whole contact table, so fanning eighteen rooftops out in
 * parallel would put eighteen full scans on the pool at once — the same
 * shape of load that used to take the app process down.
 */
export async function resolveSegmentMembership(
  definition: FilterDefinition,
  accountKeys: string[],
  opts: { excludeSegmentId?: string | null } = {},
): Promise<SegmentMembership> {
  const seen = new Set<string>();
  const byAccount: Record<string, number> = {};
  const errors: Array<{ accountKey: string; error: string }> = [];

  for (const accountKey of accountKeys) {
    // Per-account catalogue: the same definition can be valid in one
    // rooftop and reference a deleted custom field in the next.
    const fields = await resolveFilterFields(accountKey, opts.excludeSegmentId ?? null);
    const validation = validateFilterDefinition(definition, fields);
    if (!validation.ok) {
      errors.push({
        accountKey,
        error: formatFilterErrors(validation.errors),
      });
      continue;
    }

    try {
      const ids = await collectSegmentContactIds(accountKey, validation.definition, fields);
      byAccount[accountKey] = ids.length;
      for (const id of ids) {
        seen.add(id);
        if (seen.size > MAX_SEGMENT_IDS) throw new SegmentTooLargeError();
      }
    } catch (err) {
      if (err instanceof SegmentTooLargeError) throw err;
      errors.push({
        accountKey,
        error: err instanceof Error ? err.message : 'Failed to resolve segment',
      });
    }
  }

  // Every account failed and none produced ids — that is an error to
  // report, not an empty segment. Reporting it as zero members is how a
  // broken filter reads as "nobody qualifies".
  if (accountKeys.length > 0 && errors.length === accountKeys.length) {
    throw new SegmentLookupError(errors[0]!.error);
  }

  return { ids: [...seen], byAccount, errors };
}

/** Validate a definition against a single account, for callers that
 *  already know which account they're in. */
export async function validateAgainstAccount(
  definition: unknown,
  accountKey: string | null,
  excludeSegmentId?: string | null,
): Promise<FilterDefinition> {
  const fields = await resolveFilterFields(accountKey, excludeSegmentId ?? null);
  const validation =
    typeof definition === 'string'
      ? parseAndValidateFilterDefinition(definition, fields)
      : validateFilterDefinition(definition, fields);
  if (!validation.ok) {
    throw new SegmentLookupError(
      `Invalid filter definition — ${formatFilterErrors(validation.errors)}`,
    );
  }
  return validation.definition;
}
