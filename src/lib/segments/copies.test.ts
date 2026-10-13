import { describe, it, expect } from 'vitest';
import { copyMatchesSource, findPushNameClashes, planPush, type SegmentCopy } from './copies';

const base = {
  name: 'Lapsed Service',
  description: null,
  filters: '{"version":1,"logic":"AND","groups":[]}',
  icon: null,
  color: null,
};
const copy = (id: string, accountKey: string | null, over: Partial<SegmentCopy> = {}): SegmentCopy => ({
  ...base,
  id,
  accountKey,
  ...over,
});

describe('copyMatchesSource', () => {
  it('ignores key order and whitespace in the filter JSON', () => {
    const reordered = { ...base, filters: '{ "groups": [], "logic": "AND", "version": 1 }' };
    expect(copyMatchesSource(base, reordered)).toBe(true);
  });
  it('treats a changed filter, name or description as out of date', () => {
    expect(copyMatchesSource(base, { ...base, filters: '{"version":1,"logic":"OR","groups":[]}' })).toBe(false);
    expect(copyMatchesSource(base, { ...base, name: 'Lapsed' })).toBe(false);
    expect(copyMatchesSource(base, { ...base, description: 'x' })).toBe(false);
  });
  it('never matches on unparseable JSON that differs', () => {
    expect(copyMatchesSource(base, { ...base, filters: 'not json' })).toBe(false);
  });
});

describe('planPush', () => {
  const copies = [copy('a', 'ogden'), copy('b', 'provo'), copy('c', 'layton')];

  it('defaults to every linked copy', () => {
    const plan = planPush({ copies, writableKeys: ['ogden', 'provo', 'layton'], isPrivileged: false });
    expect(plan.targets.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(plan.denied).toEqual([]);
  });
  it('denies copies in accounts the caller is not assigned to', () => {
    const plan = planPush({ copies, writableKeys: ['ogden'], isPrivileged: false });
    expect(plan.targets.map((t) => t.id)).toEqual(['a']);
    expect(plan.denied.map((t) => t.id)).toEqual(['b', 'c']);
  });
  it('lets a privileged caller write anywhere', () => {
    const plan = planPush({ copies, writableKeys: [], isPrivileged: true });
    expect(plan.denied).toEqual([]);
  });
  it('reports ids that are not copies of this original instead of writing them', () => {
    const plan = planPush({ copies, requestedIds: ['a', 'zzz', 'a'], writableKeys: ['ogden'], isPrivileged: false });
    expect(plan.targets.map((t) => t.id)).toEqual(['a']);
    expect(plan.unknown).toEqual(['zzz']);
  });
  it('treats an org-wide copy as privileged-only', () => {
    const plan = planPush({ copies: [copy('o', null)], writableKeys: ['ogden'], isPrivileged: false });
    expect(plan.denied.map((t) => t.id)).toEqual(['o']);
  });
});

describe('findPushNameClashes', () => {
  it('flags a different segment already holding the name in the copy account', () => {
    const targets = [copy('a', 'ogden'), copy('b', 'provo')];
    const clashes = findPushNameClashes('Lapsed Service', targets, [
      { id: 'a', name: 'Lapsed Service', accountKey: 'ogden' }, // itself
      { id: 'other', name: 'Lapsed Service', accountKey: 'provo' },
    ]);
    expect(clashes.map((c) => c.id)).toEqual(['b']);
  });
});
