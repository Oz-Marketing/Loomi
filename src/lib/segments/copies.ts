// Pushing an original segment's changes to its linked copies.
//
// "Also create in…" writes an independent segment per account (see
// ./fan-out.ts for why they are copies and not one shared row), and each
// copy remembers its original through `Audience.sourceAudienceId`. Editing
// the original changes nothing by itself. A push is the explicit step that
// overwrites chosen copies with the original's SAVED name, description,
// filter, icon and color.
//
// Pure, like fan-out.ts: the decisions — what counts as "out of date",
// which copies this caller may overwrite — are where the bugs live, and
// route handlers aren't unit-tested here. The route keeps the queries.

/** The fields a push carries from the original to each copy. */
export interface PushableSegment {
  name: string;
  description: string | null;
  filters: string;
  icon: string | null;
  color: string | null;
}

export interface SegmentCopy extends PushableSegment {
  id: string;
  accountKey: string | null;
}

export const PUSHED_FIELDS = ['name', 'description', 'filters', 'icon', 'color'] as const;

/**
 * Whether a copy already matches its original.
 *
 * Filters are compared as parsed JSON, not as strings: the builder
 * re-serialises on every save, so two equal definitions can differ in key
 * order or whitespace and must not read as "out of date".
 */
export function copyMatchesSource(source: PushableSegment, copy: PushableSegment): boolean {
  return (
    source.name === copy.name &&
    (source.description ?? null) === (copy.description ?? null) &&
    (source.icon ?? null) === (copy.icon ?? null) &&
    (source.color ?? null) === (copy.color ?? null) &&
    sameDefinition(source.filters, copy.filters)
  );
}

function sameDefinition(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return canonical(JSON.parse(a)) === canonical(JSON.parse(b));
  } catch {
    return false;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([x], [y]) => x.localeCompare(y));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface PlanPushInput {
  /** The original's linked copies, as loaded. */
  copies: SegmentCopy[];
  /** Which copies to push to. Omitted means every linked copy. */
  requestedIds?: string[];
  /** Accounts the caller is assigned to. */
  writableKeys: string[];
  /** developer / super_admin — may write anywhere. */
  isPrivileged: boolean;
}

export interface PlanPushResult {
  /** Copies to overwrite. */
  targets: SegmentCopy[];
  /** Requested ids that are not copies of this original. */
  unknown: string[];
  /** Requested copies in accounts this caller may not write. Non-empty
   *  means refuse the whole push, the same rule fan-out applies. */
  denied: SegmentCopy[];
}

/**
 * Decide which copies a push may overwrite.
 *
 * The scope rule mirrors partitionTargets in ./fan-out.ts — a caller may
 * only write segments in accounts they're assigned to — so a push can never
 * reach an account that editing the copy directly would refuse. Being
 * allowed to edit the ORIGINAL is not enough: the copies live in other
 * accounts, and that is the whole point of them.
 *
 * Org-wide copies (null accountKey) cannot come from a fan-out, but are
 * treated as privileged-only for the same reason the PATCH route does.
 */
export function planPush({
  copies,
  requestedIds,
  writableKeys,
  isPrivileged,
}: PlanPushInput): PlanPushResult {
  const byId = new Map(copies.map((c) => [c.id, c]));
  const wanted = requestedIds ? [...new Set(requestedIds)] : copies.map((c) => c.id);
  const writable = new Set(writableKeys);

  const targets: SegmentCopy[] = [];
  const denied: SegmentCopy[] = [];
  const unknown: string[] = [];

  for (const id of wanted) {
    const copy = byId.get(id);
    if (!copy) {
      unknown.push(id);
      continue;
    }
    const mayWrite = isPrivileged || (copy.accountKey !== null && writable.has(copy.accountKey));
    (mayWrite ? targets : denied).push(copy);
  }

  return { targets, unknown, denied };
}

/**
 * Which targets would collide on the unique (name, accountKey) once renamed
 * to `name`. `existing` is every segment carrying that name in the targets'
 * accounts; a target never clashes with itself.
 */
export function findPushNameClashes(
  name: string,
  targets: SegmentCopy[],
  existing: Array<{ id: string; name: string; accountKey: string | null }>,
): SegmentCopy[] {
  const taken = new Map<string, Set<string>>();
  for (const row of existing) {
    if (row.accountKey === null || row.name !== name) continue;
    const ids = taken.get(row.accountKey) ?? new Set<string>();
    ids.add(row.id);
    taken.set(row.accountKey, ids);
  }
  return targets.filter((t) => {
    if (t.accountKey === null) return false;
    const ids = taken.get(t.accountKey);
    return !!ids && [...ids].some((id) => id !== t.id);
  });
}
