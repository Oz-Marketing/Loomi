/**
 * Who can use an ad template.
 *
 * Sharing replaces the old "Copy to Subaccounts", which cloned the doc into each
 * account: the copies immediately diverged, an edit to the master reached none of
 * them, and there was no way to take access back. One template, a list of accounts,
 * revocable.
 *
 * Every surface that lists templates for an account — the picker, the client
 * library, the automation template resolver — has to agree on this rule, so it
 * lives here as one pure function rather than as a `where` clause copied five
 * times. Pure: no prisma, so the client can reason with it too.
 */

/** The stored scoping columns, as read from `AdTemplateDoc`. */
export interface TemplateScopeRow {
  /** The owning account. Null = authored in the shared Loomi library. */
  accountKey: string | null;
  /** JSON string[] of subaccount keys, or already-parsed keys. */
  sharedAccountKeys?: string | string[] | null;
}

export function parseSharedKeys(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) return raw.filter((k): k is string => typeof k === 'string' && !!k.trim());
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string' && !!k.trim()) : [];
  } catch {
    return [];
  }
}

/** Every account explicitly granted access: the owner plus everyone shared with. */
export function templateAccessKeys(row: TemplateScopeRow): string[] {
  const keys = new Set(parseSharedKeys(row.sharedAccountKeys));
  if (row.accountKey) keys.add(row.accountKey);
  return [...keys];
}

/**
 * A template with no owner AND nothing shared is in the shared library — offered
 * to everyone. Sharing a global template deliberately narrows it: "toggle who
 * should have access" is meaningless if the answer stays "everyone".
 */
export function isGlobalTemplate(row: TemplateScopeRow): boolean {
  return !row.accountKey && parseSharedKeys(row.sharedAccountKeys).length === 0;
}

/**
 * Whether `accountKey` can use this template.
 *
 * `ancestorKeys` are the organization/group accounts above it — a template
 * authored at a group is inherited by every sub-account beneath it, which predates
 * sharing and still holds.
 */
export function canAccountUseTemplate(
  row: TemplateScopeRow,
  ctx: { accountKey: string | null; ancestorKeys?: string[] },
): boolean {
  if (isGlobalTemplate(row)) return true;
  if (!ctx.accountKey) return false;
  const granted = templateAccessKeys(row);
  if (granted.includes(ctx.accountKey)) return true;
  // Inheritance applies to the OWNER only. A group's own template flows down; one
  // shared with a sibling rooftop does not become the group's to hand out.
  return !!row.accountKey && (ctx.ancestorKeys ?? []).includes(row.accountKey);
}

/** Filter a list to what one account may use. */
export function templatesForAccount<T extends TemplateScopeRow>(
  rows: T[],
  ctx: { accountKey: string | null; ancestorKeys?: string[] },
): T[] {
  return rows.filter((r) => canAccountUseTemplate(r, ctx));
}

/** Filter to what ANY of several accounts may use (a client with multiple scopes). */
export function templatesForAnyAccount<T extends TemplateScopeRow>(
  rows: T[],
  accountKeys: string[],
  ancestorKeys: string[] = [],
): T[] {
  return rows.filter(
    (r) =>
      isGlobalTemplate(r)
      || accountKeys.some((k) => canAccountUseTemplate(r, { accountKey: k, ancestorKeys })),
  );
}

/**
 * The `where` fragment every template SELECTION must carry: a soft-deleted
 * template is not a template anyone can list, pick, sync from or generate
 * against.
 *
 * Spelled once here for the same reason the access rule above is: the filter is
 * needed at nine call sites across the library, the automation resolver, the
 * taxonomy facets and the playbook context, and a soft delete that one of them
 * forgets is worse than none at all — the row looks gone in the library and
 * still quietly feeds unattended generation.
 *
 * Deliberately NOT applied to fetch-by-id: restoring a template requires reading
 * a deleted one, and the by-id GET reports `deletedAt` so the caller decides.
 */
export const LIVE_TEMPLATE = { deletedAt: null } as const;

/** Normalise a client-supplied share list for storage. */
export function serializeSharedKeys(keys: unknown): string | null {
  if (!Array.isArray(keys)) return null;
  const clean = [...new Set(keys.filter((k): k is string => typeof k === 'string' && !!k.trim()).map((k) => k.trim()))];
  return clean.length ? JSON.stringify(clean) : null;
}
