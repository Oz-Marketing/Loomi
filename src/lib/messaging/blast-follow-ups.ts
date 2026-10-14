// Follow-up ("resend to non-engaged") blasts, nested under the blast they
// follow up on.
//
// A follow-up is a real EmailBlast of its own — created when its original
// finishes, scheduled `delayHours` later, and carrying `resendOf: <parentId>`
// in its metadata (see queueFollowUp in lib/services/email-blasts.ts). The
// Blasts list used to show it as just another row, distinguishable only by a
// "(follow-up)" suffix on the name, which crowded the table and hid the one
// thing worth knowing: what the second send added to the first.
//
// Pure so the grouping rules — which rows nest, what survives a date or
// search filter, what the combined numbers mean — are unit-tested; the list
// component only renders the result.

export interface FollowUpRow {
  id: string;
  /** The blast this one follows up on, when it is a follow-up. */
  resendOf?: string;
}

export interface FollowUpGroups<T extends FollowUpRow> {
  /** Rows shown at the top level: originals, standalone blasts, and any
   *  follow-up whose original isn't in the list (archived, or another
   *  account's), which would otherwise vanish. */
  roots: T[];
  /** Follow-ups keyed by their original's id, in list order. */
  byParent: Map<string, T[]>;
}

export function groupFollowUps<T extends FollowUpRow>(rows: readonly T[]): FollowUpGroups<T> {
  const ids = new Set(rows.map((r) => r.id));
  const roots: T[] = [];
  const byParent = new Map<string, T[]>();
  for (const row of rows) {
    const parent = row.resendOf;
    if (parent && parent !== row.id && ids.has(parent)) {
      const list = byParent.get(parent) ?? [];
      list.push(row);
      byParent.set(parent, list);
    } else {
      roots.push(row);
    }
  }
  return { roots, byParent };
}

/**
 * Narrow `rows` with `keep`, without splitting a follow-up from its original.
 *
 * A follow-up in range pulls its original in, and an original in range keeps
 * its follow-ups — otherwise "Last 7 days" would show a follow-up with nowhere
 * to nest, or an original whose follow-up silently disappeared.
 */
export function filterKeepingFamilies<T extends FollowUpRow>(
  rows: readonly T[],
  keep: (row: T) => boolean,
): T[] {
  const kept = new Set<string>();
  for (const row of rows) {
    if (keep(row)) {
      kept.add(row.id);
      if (row.resendOf) kept.add(row.resendOf);
    }
  }
  return rows.filter((row) => kept.has(row.id) || (row.resendOf ? kept.has(row.resendOf) : false));
}

/** Rows the list counts as campaigns: a follow-up is part of its original. */
export function countTopLevel<T extends FollowUpRow>(rows: readonly T[]): number {
  return groupFollowUps(rows).roots.length;
}

export interface SendEngagement {
  sent: number;
  uniqueOpens: number;
}

export interface CombinedReach {
  /** Distinct people who opened either send. */
  opened: number;
  /** The original's audience. */
  audience: number;
  /** Opened after the first send alone. */
  openedFirst: number;
  rate: number;
}

/**
 * Who opened across the original and its follow-ups.
 *
 * Unique opens ADD because a follow-up's audience excludes everyone who
 * opened or clicked the original (RESEND_EXCLUDING_EVENTS), so no person can
 * be counted in both. The denominator is the original's audience: the
 * follow-up's recipients are a subset of it. Null until a follow-up has sent
 * to someone — there is no "combined" before the second send exists.
 */
export function combinedReach(
  original: SendEngagement | undefined,
  followUps: ReadonlyArray<SendEngagement | undefined>,
): CombinedReach | null {
  if (!original || original.sent <= 0) return null;
  const sent = followUps.filter((f): f is SendEngagement => !!f && f.sent > 0);
  if (sent.length === 0) return null;
  const opened = original.uniqueOpens + sent.reduce((sum, f) => sum + f.uniqueOpens, 0);
  return {
    opened,
    audience: original.sent,
    openedFirst: original.uniqueOpens,
    rate: opened / original.sent,
  };
}
