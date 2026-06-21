/**
 * Layers-panel tree helpers (pure). Elements carry an optional `groupId`; the
 * Layers panel shows groups as a parent with its members nested underneath.
 *
 * A group appears at the position of its FRONTMOST member (the list is ordered
 * front→back, i.e. highest z first), and its members are listed in that same
 * order beneath it. Re-building entries from any flat order keeps a group's
 * members contiguous — so dragging one member moves the whole group, and an
 * ungrouped element can never wedge between a group's members.
 */

export interface GroupLayerEntry {
  kind: 'group';
  groupId: string;
  memberIds: string[];
}
export interface ElementLayerEntry {
  kind: 'element';
  id: string;
}
export type LayerEntry = GroupLayerEntry | ElementLayerEntry;

/** Build top-level Layers entries from elements in front→back order. */
export function buildLayerEntries(order: { id: string; groupId?: string | null }[]): LayerEntry[] {
  const entries: LayerEntry[] = [];
  const byGroup = new Map<string, GroupLayerEntry>();
  for (const { id, groupId } of order) {
    if (groupId) {
      let g = byGroup.get(groupId);
      if (!g) {
        g = { kind: 'group', groupId, memberIds: [] };
        byGroup.set(groupId, g);
        entries.push(g);
      }
      g.memberIds.push(id);
    } else {
      entries.push({ kind: 'element', id });
    }
  }
  return entries;
}

/** Flatten entries to a front→back element-id list (group members contiguous). */
export function flattenLayerEntries(entries: LayerEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.kind === 'group') out.push(...e.memberIds);
    else out.push(e.id);
  }
  return out;
}

/** Re-cluster a flat front→back order so each group's members are contiguous. */
export function clusterByGroup(order: { id: string; groupId?: string | null }[]): string[] {
  return flattenLayerEntries(buildLayerEntries(order));
}
