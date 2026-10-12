// Split a list into fixed-size slices.
//
// Postgres caps one statement at 65,535 bind parameters, so an `IN (…)` filter
// or a `createMany` built from an unbounded audience has to be sent in pieces.
// Blasts were capped at 5,000 recipients until 2026-10-12, which kept every
// such query under the limit by accident; with the cap gone, anything sized by
// an audience goes through this.

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Slice size for `IN` lists and bulk inserts — far below the parameter cap. */
export const DB_CHUNK = 5000;
