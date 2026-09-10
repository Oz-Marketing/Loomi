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
 * ACCESS IS EXPLICIT. A group's template used to flow down to every account
 * beneath it automatically, which made the Availability modal a liar: a group
 * picking "only us" was in fact publishing to its whole fleet, and there was no
 * setting anywhere that said so or could undo it. Now the owner sees it, and
 * everyone else is on the share list or is not.
 *
 * That is the whole rule. The three states a person can choose — draft, self,
 * shared with named accounts — are the three states that exist, with nothing
 * implicit underneath them.
 */
export function canAccountUseTemplate(
  row: TemplateScopeRow,
  ctx: { accountKey: string | null },
): boolean {
  if (isGlobalTemplate(row)) return true;
  if (!ctx.accountKey) return false;
  return templateAccessKeys(row).includes(ctx.accountKey);
}

/** Filter a list to what one account may use. */
export function templatesForAccount<T extends TemplateScopeRow>(
  rows: T[],
  ctx: { accountKey: string | null },
): T[] {
  return rows.filter((r) => canAccountUseTemplate(r, ctx));
}

/** Filter to what ANY of several accounts may use (a client with multiple scopes). */
export function templatesForAnyAccount<T extends TemplateScopeRow>(
  rows: T[],
  accountKeys: string[],
): T[] {
  return rows.filter(
    (r) => isGlobalTemplate(r) || accountKeys.some((k) => canAccountUseTemplate(r, { accountKey: k })),
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

/**
 * WHO a template is for, as one value.
 *
 * Publishing and sharing were two controls that each told half the truth. The
 * library card read its scope off `accountKey` alone, so a shared-library
 * template narrowed to three dealers still announced "All accounts" — while the
 * rule above had already narrowed it to exactly those three. Two settings, two
 * surfaces, and the one that was easiest to look at was the one that was wrong.
 *
 * So audience is derived HERE, from the same columns `canAccountUseTemplate`
 * reads, and every surface renders this instead of re-deriving it. If the two
 * ever disagree again it will be because someone changed this function, which is
 * the point.
 *
 * Deliberately says nothing about draft/published. That is a separate axis — WHEN
 * rather than WHO — and collapsing them would lose the distinction between "a
 * draft meant for everyone" and "a live template meant for three dealers".
 */
export type TemplateAudience =
  | { kind: 'all' }
  | { kind: 'accounts'; keys: string[] };

export function templateAudience(row: TemplateScopeRow): TemplateAudience {
  if (isGlobalTemplate(row)) return { kind: 'all' };
  return { kind: 'accounts', keys: templateAccessKeys(row) };
}

/**
 * The audience as one short phrase, for a card or a chip.
 *
 * `nameFor` resolves an account key to its dealer name; the caller owns that map,
 * so this stays pure and usable on either side of the wire.
 */
export function audienceLabel(row: TemplateScopeRow, nameFor: (key: string) => string): string {
  const audience = templateAudience(row);
  if (audience.kind === 'all') return 'All accounts';
  const { keys } = audience;
  if (keys.length === 0) return 'No accounts';
  if (keys.length === 1) return nameFor(keys[0]);
  return `${keys.length} accounts`;
}
