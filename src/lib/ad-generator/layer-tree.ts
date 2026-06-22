/**
 * Layers-panel tree helpers (pure). Elements carry an optional `groupId` (their
 * innermost group); groups nest via `parentId`. The Layers panel shows this as a
 * recursive tree — a group can contain elements AND sub-groups.
 *
 * Ordering is front→back (highest z first). An element sits at its z; a group
 * sits at the position of its frontmost descendant element, with its children
 * laid out beneath it. Re-deriving the tree from any flat order keeps a group's
 * descendants contiguous, so dragging one member moves the whole group and an
 * outside element can never wedge into a group's run.
 */

export interface GroupMeta {
  id: string;
  name?: string;
  parentId?: string | null;
  collapsed?: boolean;
}

export interface ElementRef {
  id: string;
  groupId?: string | null;
}

export type LayerNode =
  | { kind: 'element'; id: string }
  | { kind: 'group'; groupId: string; children: LayerNode[] };

/**
 * Build the nested Layers tree. `order` is elements front→back (highest z
 * first); `groups` is the group hierarchy. Groups are positioned by their
 * frontmost descendant element; empty groups sort to the back.
 */
export function buildLayerTree(order: ElementRef[], groups: GroupMeta[]): LayerNode[] {
  const rank = new Map<string, number>();
  order.forEach((e, i) => rank.set(e.id, i));
  const elementGroup = new Map<string, string | null>(order.map((e) => [e.id, e.groupId ?? null]));
  const groupParent = new Map<string, string | null>(groups.map((g) => [g.id, g.parentId ?? null]));
  const knownGroup = new Set(groups.map((g) => g.id));

  // Child lists keyed by parent ('' = root).
  const ROOT = '';
  const childElements = new Map<string, string[]>();
  const childGroups = new Map<string, string[]>();
  for (const e of order) {
    const gid = elementGroup.get(e.id);
    const key = gid && knownGroup.has(gid) ? gid : ROOT;
    (childElements.get(key) ?? childElements.set(key, []).get(key)!).push(e.id);
  }
  for (const g of groups) {
    const p = groupParent.get(g.id);
    const key = p && knownGroup.has(p) ? p : ROOT;
    (childGroups.get(key) ?? childGroups.set(key, []).get(key)!).push(g.id);
  }

  // Frontmost (min) rank of any descendant element — memoized, cycle-safe.
  const groupRankCache = new Map<string, number>();
  const computing = new Set<string>();
  const groupRank = (gid: string): number => {
    if (groupRankCache.has(gid)) return groupRankCache.get(gid)!;
    if (computing.has(gid)) return Infinity; // guard against a cyclic parentId
    computing.add(gid);
    let best = Infinity;
    for (const eid of childElements.get(gid) ?? []) best = Math.min(best, rank.get(eid) ?? Infinity);
    for (const sub of childGroups.get(gid) ?? []) best = Math.min(best, groupRank(sub));
    computing.delete(gid);
    groupRankCache.set(gid, best);
    return best;
  };

  const build = (parent: string): LayerNode[] => {
    const entries: { rank: number; node: LayerNode }[] = [];
    for (const eid of childElements.get(parent) ?? []) {
      entries.push({ rank: rank.get(eid) ?? Infinity, node: { kind: 'element', id: eid } });
    }
    for (const gid of childGroups.get(parent) ?? []) {
      entries.push({ rank: groupRank(gid), node: { kind: 'group', groupId: gid, children: build(gid) } });
    }
    entries.sort((a, b) => a.rank - b.rank);
    return entries.map((e) => e.node);
  };

  return build(ROOT);
}

/** Flatten a tree to a front→back element-id list (group descendants contiguous). */
export function flattenLayerTree(nodes: LayerNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: LayerNode[]) => {
    for (const n of ns) {
      if (n.kind === 'element') out.push(n.id);
      else walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

interface ZBox {
  z?: number;
}

/**
 * Reassign per-size z so the canvas stacking matches the Layers tree: within
 * each size, order by current z (front→back), re-derive the tree (which keeps
 * group descendants contiguous), then write contiguous z back (front = highest).
 */
export function normalizeGroupZ<B extends ZBox>(
  elements: ElementRef[],
  groups: GroupMeta[],
  sizes: { id: string }[],
  layouts: Record<string, Record<string, B>>,
): Record<string, Record<string, B>> {
  const groupOf = new Map(elements.map((e) => [e.id, e.groupId ?? null]));
  const out: Record<string, Record<string, B>> = {};
  for (const s of sizes) {
    const lay = layouts[s.id] ?? {};
    const ids = Object.keys(lay).sort((a, b) => (lay[b].z ?? 0) - (lay[a].z ?? 0)); // front→back
    const ordered = flattenLayerTree(buildLayerTree(ids.map((id) => ({ id, groupId: groupOf.get(id) ?? null })), groups));
    const n = ordered.length;
    const sized: Record<string, B> = { ...lay };
    ordered.forEach((id, i) => {
      sized[id] = { ...sized[id], z: n - i }; // front of list = highest z
    });
    out[s.id] = sized;
  }
  return out;
}
