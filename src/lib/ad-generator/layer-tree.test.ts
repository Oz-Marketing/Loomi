import { describe, it, expect } from 'vitest';
import { buildLayerTree, flattenLayerTree, normalizeGroupZ, type GroupMeta } from './layer-tree';

describe('layer-tree (nested)', () => {
  it('nests a group at its frontmost member', () => {
    const tree = buildLayerTree(
      [{ id: 'a', groupId: 'g1' }, { id: 'b' }, { id: 'c', groupId: 'g1' }],
      [{ id: 'g1' }],
    );
    expect(tree).toEqual([
      { kind: 'group', groupId: 'g1', children: [{ kind: 'element', id: 'a' }, { kind: 'element', id: 'c' }] },
      { kind: 'element', id: 'b' },
    ]);
  });

  it('builds a group inside a group (parentId)', () => {
    // g2 nested in g1; order front→back: a(g2), b(g1), c(root)
    const groups: GroupMeta[] = [{ id: 'g1' }, { id: 'g2', parentId: 'g1' }];
    const tree = buildLayerTree([{ id: 'a', groupId: 'g2' }, { id: 'b', groupId: 'g1' }, { id: 'c' }], groups);
    expect(tree).toEqual([
      {
        kind: 'group',
        groupId: 'g1',
        children: [
          { kind: 'group', groupId: 'g2', children: [{ kind: 'element', id: 'a' }] },
          { kind: 'element', id: 'b' },
        ],
      },
      { kind: 'element', id: 'c' },
    ]);
  });

  it('flattens depth-first, keeping descendants contiguous', () => {
    const groups: GroupMeta[] = [{ id: 'g1' }, { id: 'g2', parentId: 'g1' }];
    const tree = buildLayerTree([{ id: 'a', groupId: 'g2' }, { id: 'b', groupId: 'g1' }, { id: 'c' }], groups);
    expect(flattenLayerTree(tree)).toEqual(['a', 'b', 'c']);
  });

  it('normalizeGroupZ pulls a nested group together and reassigns z', () => {
    // z desc: a(g2,z4) d(z3) b(g1,z2) c(z1) — d (root) sits between g1's members.
    const elements = [{ id: 'a', groupId: 'g2' }, { id: 'd' }, { id: 'b', groupId: 'g1' }, { id: 'c' }];
    const groups: GroupMeta[] = [{ id: 'g1' }, { id: 'g2', parentId: 'g1' }];
    const layouts = { sq: { a: { z: 4 }, d: { z: 3 }, b: { z: 2 }, c: { z: 1 } } };
    const out = normalizeGroupZ(elements, groups, [{ id: 'sq' }], layouts);
    // g1 (a,b) clusters at front, then d, then c → z 4,3,2,1.
    expect(out.sq.a.z).toBe(4);
    expect(out.sq.b.z).toBe(3);
    expect(out.sq.d.z).toBe(2);
    expect(out.sq.c.z).toBe(1);
  });
});
