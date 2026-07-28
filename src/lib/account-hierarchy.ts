/**
 * Pure graph walks over the account hierarchy.
 *
 * These used to live inline in `services/accounts.ts` against a live Prisma
 * query. They're split out because one of them — `relatedKeys` — is the
 * suppression cascade, and under-propagating an opt-out is a compliance
 * failure, not a bug. Keeping the traversal pure means it can be tested
 * against a hand-built tree instead of a database.
 *
 * `services/accounts.ts` does the single `findMany` and hands the edge list
 * here. Every function tolerates a malformed parent cycle rather than looping
 * forever — bad data should degrade, not hang the request.
 */

/** One row of the hierarchy: an account and the account it hangs under. */
export interface AccountEdge {
  key: string;
  parentAccountKey: string | null;
}

function childIndex(edges: AccountEdge[]): Map<string, string[]> {
  const childrenOf = new Map<string, string[]>();
  for (const a of edges) {
    if (!a.parentAccountKey) continue;
    const list = childrenOf.get(a.parentAccountKey) ?? [];
    list.push(a.key);
    childrenOf.set(a.parentAccountKey, list);
  }
  return childrenOf;
}

/**
 * The given keys plus every account beneath them. Granting a group account
 * (e.g. `youngAutomotiveGroup`) implies access to each of its rooftops, so all
 * the accountKey-scoped queries keep working unchanged.
 */
export function expandWithDescendants(edges: AccountEdge[], keys: string[]): string[] {
  if (keys.length === 0) return [];
  const childrenOf = childIndex(edges);

  const out = new Set<string>(keys);
  const stack = [...keys];
  while (stack.length) {
    const key = stack.pop()!;
    for (const child of childrenOf.get(key) ?? []) {
      if (out.has(child)) continue; // also guards a malformed parent cycle
      out.add(child);
      stack.push(child);
    }
  }
  return [...out];
}

/**
 * The account's ancestors, nearest first — parent, then grandparent, etc.
 * Powers "author once, inherit down": a rooftop sees the templates, forms and
 * landing pages owned by its group account.
 */
export function ancestorKeys(edges: AccountEdge[], accountKey: string): string[] {
  const parentOf = new Map(edges.map((a) => [a.key, a.parentAccountKey]));

  const chain: string[] = [];
  const seen = new Set<string>([accountKey]);
  let cursor = parentOf.get(accountKey) ?? null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor); // guards a malformed parent cycle
    chain.push(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return chain;
}

/**
 * Every OTHER account grouped with `accountKey` — the set a suppression must
 * cascade to, so an opt-out at one rooftop silences the whole group.
 *
 * Climbs to the top of the tree, then takes every descendant of that root,
 * minus self. Deliberately NOT the `self + descendants` set a roll-up view
 * uses: a rooftop's opt-out must also reach its PARENT and its SIBLINGS.
 * Under-propagating is a compliance failure, so this is the wider set on
 * purpose.
 *
 * Returns `[]` for a standalone account and for an unknown key — in both cases
 * there is genuinely nothing to cascade to.
 */
export function relatedKeys(edges: AccountEdge[], accountKey: string): string[] {
  if (!edges.some((a) => a.key === accountKey)) return [];

  const parentOf = new Map(edges.map((a) => [a.key, a.parentAccountKey]));
  const childrenOf = childIndex(edges);

  // Climb to the root of this account's tree.
  let root = accountKey;
  const climbed = new Set<string>([root]);
  for (;;) {
    const parent = parentOf.get(root) ?? null;
    if (!parent || climbed.has(parent)) break; // null parent, or a malformed cycle
    climbed.add(parent);
    root = parent;
  }

  // Standalone: nothing above and nothing below.
  if (root === accountKey && (childrenOf.get(accountKey) ?? []).length === 0) return [];

  const related = new Set<string>();
  const stack = [root];
  const seen = new Set<string>();
  while (stack.length) {
    const key = stack.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    related.add(key);
    for (const child of childrenOf.get(key) ?? []) stack.push(child);
  }
  related.delete(accountKey);
  return [...related];
}
