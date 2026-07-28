import { describe, expect, it } from 'vitest';
import {
  ancestorKeys,
  expandWithDescendants,
  relatedKeys,
  selectableParentKeys,
  type AccountEdge,
} from './account-hierarchy';

/**
 * Production shape: one group account with rooftops under it, plus unrelated
 * standalone accounts that must never be caught by a cascade.
 */
const YAG_ROOFTOPS = ['yagFord', 'yagChevy', 'yagKia', 'yagNissan'];
const TREE: AccountEdge[] = [
  { key: 'youngAutomotiveGroup', parentAccountKey: null },
  ...YAG_ROOFTOPS.map((key) => ({ key, parentAccountKey: 'youngAutomotiveGroup' })),
  // Standalones — their own client, no group.
  { key: 'pjfCorp', parentAccountKey: null },
  { key: 'someOtherDealer', parentAccountKey: null },
];

const sorted = (keys: string[]) => [...keys].sort();

describe('relatedKeys — the suppression cascade', () => {
  it('cascades a rooftop opt-out to the group and every sibling', () => {
    // The compliance requirement: opting out at one rooftop must silence the
    // whole group, upward to the parent and sideways to the siblings.
    expect(sorted(relatedKeys(TREE, 'yagFord'))).toEqual(
      sorted(['youngAutomotiveGroup', 'yagChevy', 'yagKia', 'yagNissan']),
    );
  });

  it('cascades a group opt-out down to every rooftop', () => {
    expect(sorted(relatedKeys(TREE, 'youngAutomotiveGroup'))).toEqual(sorted(YAG_ROOFTOPS));
  });

  it('never reaches an unrelated tree', () => {
    for (const key of [...YAG_ROOFTOPS, 'youngAutomotiveGroup']) {
      expect(relatedKeys(TREE, key)).not.toContain('pjfCorp');
      expect(relatedKeys(TREE, key)).not.toContain('someOtherDealer');
    }
  });

  it('cascades to nothing for a standalone account', () => {
    // pjfCorp is its own client — an opt-out there stays there.
    expect(relatedKeys(TREE, 'pjfCorp')).toEqual([]);
  });

  it('never includes the account itself', () => {
    for (const { key } of TREE) {
      expect(relatedKeys(TREE, key)).not.toContain(key);
    }
  });

  it('returns nothing for an unknown key rather than throwing', () => {
    expect(relatedKeys(TREE, 'noSuchAccount')).toEqual([]);
  });

  it('reaches across a deeper tree, not just one level', () => {
    const deep: AccountEdge[] = [
      { key: 'holdco', parentAccountKey: null },
      { key: 'regionWest', parentAccountKey: 'holdco' },
      { key: 'regionEast', parentAccountKey: 'holdco' },
      { key: 'westFord', parentAccountKey: 'regionWest' },
      { key: 'eastKia', parentAccountKey: 'regionEast' },
    ];
    // A leaf opt-out climbs to the root and comes back down the other branch.
    expect(sorted(relatedKeys(deep, 'westFord'))).toEqual(
      sorted(['holdco', 'regionWest', 'regionEast', 'eastKia']),
    );
  });

  it('terminates on a malformed parent cycle', () => {
    const cyclic: AccountEdge[] = [
      { key: 'a', parentAccountKey: 'b' },
      { key: 'b', parentAccountKey: 'a' },
    ];
    expect(relatedKeys(cyclic, 'a')).toEqual(['b']);
  });
});

describe('expandWithDescendants — access grants', () => {
  it('turns a group grant into every rooftop beneath it', () => {
    expect(sorted(expandWithDescendants(TREE, ['youngAutomotiveGroup']))).toEqual(
      sorted(['youngAutomotiveGroup', ...YAG_ROOFTOPS]),
    );
  });

  it('does NOT widen a rooftop grant upward — only down', () => {
    // Unlike the suppression cascade, access must not leak to siblings.
    expect(expandWithDescendants(TREE, ['yagFord'])).toEqual(['yagFord']);
  });

  it('leaves a standalone grant alone', () => {
    expect(expandWithDescendants(TREE, ['pjfCorp'])).toEqual(['pjfCorp']);
  });

  it('is empty for no grants — an empty grant list is not "everything"', () => {
    expect(expandWithDescendants(TREE, [])).toEqual([]);
  });

  it('dedupes when a grant covers both a parent and its child', () => {
    const out = expandWithDescendants(TREE, ['youngAutomotiveGroup', 'yagFord']);
    expect(sorted(out)).toEqual(sorted(['youngAutomotiveGroup', ...YAG_ROOFTOPS]));
  });

  it('terminates on a malformed parent cycle', () => {
    const cyclic: AccountEdge[] = [
      { key: 'a', parentAccountKey: 'b' },
      { key: 'b', parentAccountKey: 'a' },
    ];
    expect(sorted(expandWithDescendants(cyclic, ['a']))).toEqual(['a', 'b']);
  });
});

describe('selectableParentKeys — the Organization dropdown', () => {
  it('offers unrelated accounts', () => {
    expect(sorted(selectableParentKeys(TREE, 'pjfCorp'))).toEqual(
      sorted(['youngAutomotiveGroup', ...YAG_ROOFTOPS, 'someOtherDealer']),
    );
  });

  it('never offers the account itself', () => {
    for (const { key } of TREE) {
      expect(selectableParentKeys(TREE, key)).not.toContain(key);
    }
  });

  it('never offers a descendant — that would be a cycle', () => {
    const offered = selectableParentKeys(TREE, 'youngAutomotiveGroup');
    for (const rooftop of YAG_ROOFTOPS) expect(offered).not.toContain(rooftop);
    expect(sorted(offered)).toEqual(sorted(['pjfCorp', 'someOtherDealer']));
  });

  it('excludes indirect descendants, not just direct children', () => {
    const deep: AccountEdge[] = [
      { key: 'holdco', parentAccountKey: null },
      { key: 'regionWest', parentAccountKey: 'holdco' },
      { key: 'westFord', parentAccountKey: 'regionWest' },
      { key: 'unrelated', parentAccountKey: null },
    ];
    // westFord is a grandchild — still must not be offered as holdco's parent.
    expect(selectableParentKeys(deep, 'holdco')).toEqual(['unrelated']);
  });

  it('still offers the current parent, so a sibling move is possible', () => {
    // Moving yagFord from the group to someOtherDealer must stay available.
    expect(selectableParentKeys(TREE, 'yagFord')).toContain('youngAutomotiveGroup');
    expect(selectableParentKeys(TREE, 'yagFord')).toContain('someOtherDealer');
  });
});

describe('ancestorKeys — template inheritance', () => {
  it('returns the chain nearest-first', () => {
    const deep: AccountEdge[] = [
      { key: 'holdco', parentAccountKey: null },
      { key: 'regionWest', parentAccountKey: 'holdco' },
      { key: 'westFord', parentAccountKey: 'regionWest' },
    ];
    expect(ancestorKeys(deep, 'westFord')).toEqual(['regionWest', 'holdco']);
  });

  it('is empty for a top-level account', () => {
    expect(ancestorKeys(TREE, 'youngAutomotiveGroup')).toEqual([]);
    expect(ancestorKeys(TREE, 'pjfCorp')).toEqual([]);
  });

  it('excludes the account itself, so a rooftop never inherits from itself twice', () => {
    expect(ancestorKeys(TREE, 'yagFord')).toEqual(['youngAutomotiveGroup']);
  });

  it('terminates on a malformed parent cycle', () => {
    const cyclic: AccountEdge[] = [
      { key: 'a', parentAccountKey: 'b' },
      { key: 'b', parentAccountKey: 'a' },
    ];
    expect(ancestorKeys(cyclic, 'a')).toEqual(['b']);
  });
});
