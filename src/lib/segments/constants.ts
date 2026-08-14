// Shared between the (browser-safe) filter engine and the server-side
// resolver, so both agree on how a segment reference is spelled.
// Deliberately dependency-free — the engine must not pull in Prisma.

import type { FilterOperator } from '@/lib/smart-list-types';

/** The pseudo-field key a segment reference is stored under. */
export const SEGMENT_REF_FIELD = 'segmentRef';

export const SEGMENT_REF_OPERATORS: readonly FilterOperator[] = [
  'in_segment',
  'not_in_segment',
];
