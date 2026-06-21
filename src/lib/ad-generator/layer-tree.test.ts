import { describe, it, expect } from 'vitest';
import { buildLayerEntries, flattenLayerEntries, clusterByGroup } from './layer-tree';

describe('layer-tree', () => {
  it('nests a group at its frontmost member, members in order', () => {
    const entries = buildLayerEntries([
      { id: 'a', groupId: 'g1' },
      { id: 'b' },
      { id: 'c', groupId: 'g1' },
    ]);
    expect(entries).toEqual([
      { kind: 'group', groupId: 'g1', memberIds: ['a', 'c'] },
      { kind: 'element', id: 'b' },
    ]);
  });

  it('keeps ungrouped elements standalone, in order', () => {
    const entries = buildLayerEntries([{ id: 'x' }, { id: 'y' }]);
    expect(entries).toEqual([
      { kind: 'element', id: 'x' },
      { kind: 'element', id: 'y' },
    ]);
  });

  it('clusterByGroup pulls scattered members together at the frontmost', () => {
    // b (ungrouped) sits between two members of g1 → it gets pushed below the group.
    expect(clusterByGroup([{ id: 'a', groupId: 'g1' }, { id: 'b' }, { id: 'c', groupId: 'g1' }])).toEqual(['a', 'c', 'b']);
  });

  it('flatten is the inverse of build for already-contiguous input', () => {
    const order = [{ id: 'a', groupId: 'g1' }, { id: 'c', groupId: 'g1' }, { id: 'b' }];
    expect(flattenLayerEntries(buildLayerEntries(order))).toEqual(['a', 'c', 'b']);
  });
});
