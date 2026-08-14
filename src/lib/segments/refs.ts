// Resolve the segments a definition references, so both engines can
// evaluate composition (`is in segment X` / `is not in segment X`).
//
// The referenced segment's DEFINITION is what gets loaded, not its
// member list. That matters for three reasons:
//
//   - Composition costs nothing extra at resolve time: the SQL
//     translator inlines the referenced WHERE as a subexpression, and
//     the JS engine recursively evaluates it against the same contact.
//     No nested scan, no id set to materialise, no 40,000-element query
//     parameter.
//   - It can't go stale. A segment referencing another always means what
//     that other segment means *right now*.
//   - Both engines stay structurally identical, which is what the
//     differential tests rely on.
//
// Cycles are the obvious hazard (A excludes B, B excludes A), so the
// walk tracks its ancestry and refuses to recurse into a segment already
// on the path.

import { prisma } from '@/lib/prisma';
import type { FilterDefinition } from '@/lib/smart-list-types';
import { SEGMENT_REF_FIELD, SEGMENT_REF_OPERATORS } from './constants';

/** audienceId → that segment's filter definition. */
export type SegmentRefs = Map<string, FilterDefinition>;

/**
 * How deep composition may nest. Segments referencing segments is a
 * useful one or two levels deep ("lapsed service, excluding recent
 * buyers"); beyond that it's almost certainly a mistake, and the bound
 * keeps a pathological chain from turning one preview into hundreds of
 * queries.
 */
export const MAX_SEGMENT_REF_DEPTH = 5;

export class SegmentRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SegmentRefError';
  }
}

/** Every audience id referenced directly by a definition. */
export function collectSegmentRefIds(definition: FilterDefinition): string[] {
  const ids: string[] = [];
  for (const group of definition.groups ?? []) {
    for (const condition of group?.conditions ?? []) {
      if (
        condition?.field === SEGMENT_REF_FIELD &&
        SEGMENT_REF_OPERATORS.includes(condition.operator) &&
        condition.value?.trim()
      ) {
        ids.push(condition.value.trim());
      }
    }
  }
  return ids;
}

/**
 * Load every definition reachable from `definition`, following nested
 * references. Returns an empty map when nothing is referenced, so the
 * common case costs no queries.
 *
 * @throws SegmentRefError on a cycle, a missing segment, an
 *   out-of-account reference, or excessive nesting — all of which must
 *   surface as an error rather than silently resolving to "matches
 *   nothing", since either failure mode changes who lands in an audience.
 */
export async function loadSegmentRefs(
  accountKey: string,
  definition: FilterDefinition,
  seen: SegmentRefs = new Map(),
  path: string[] = [],
): Promise<SegmentRefs> {
  if (path.length >= MAX_SEGMENT_REF_DEPTH) {
    throw new SegmentRefError(
      `Segment references nest more than ${MAX_SEGMENT_REF_DEPTH} deep`,
    );
  }

  for (const id of collectSegmentRefIds(definition)) {
    if (path.includes(id)) {
      throw new SegmentRefError(
        `Segments reference each other in a loop (${[...path, id].join(' → ')})`,
      );
    }
    if (seen.has(id)) continue;

    const audience = await prisma.audience.findUnique({
      where: { id },
      select: { id: true, accountKey: true, filters: true, name: true },
    });
    if (!audience) {
      throw new SegmentRefError(`Referenced segment ${id} no longer exists`);
    }
    // Org-wide segments (null accountKey) are referenceable everywhere;
    // an account-scoped one only from its own account.
    if (audience.accountKey && audience.accountKey !== accountKey) {
      throw new SegmentRefError(
        `Referenced segment "${audience.name}" belongs to a different account`,
      );
    }

    let parsed: FilterDefinition;
    try {
      parsed = JSON.parse(audience.filters) as FilterDefinition;
    } catch {
      throw new SegmentRefError(
        `Referenced segment "${audience.name}" has an unreadable filter`,
      );
    }
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.groups)) {
      throw new SegmentRefError(
        `Referenced segment "${audience.name}" has an invalid filter`,
      );
    }

    seen.set(id, parsed);
    await loadSegmentRefs(accountKey, parsed, seen, [...path, id]);
  }

  return seen;
}
