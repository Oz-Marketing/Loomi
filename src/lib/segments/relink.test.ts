import { describe, it, expect } from 'vitest';
import { planRelink, type RelinkSegment } from './relink';

const base = {
  name: 'All Sales & Service',
  description: null,
  filters: '{"version":1,"logic":"OR","groups":[]}',
  icon: null,
  color: null,
};
const seg = (id: string, accountKey: string | null, over: Partial<RelinkSegment> = {}): RelinkSegment => ({
  ...base,
  id,
  accountKey,
  sourceAudienceId: null,
  ...over,
});

const source = seg('src', 'group');
const descendantKeys = ['storeA', 'storeB', 'storeC'];
const ids = (rows: RelinkSegment[]) => rows.map((r) => r.id);

describe('planRelink', () => {
  it('links unlinked same-named segments in the group\'s accounts', () => {
    const plan = planRelink({
      source,
      candidates: [source, seg('a', 'storeA'), seg('b', 'storeB')],
      descendantKeys,
    });
    expect(ids(plan.link)).toEqual(['a', 'b']);
    expect(plan.skipped).toEqual([]);
  });

  it('links a copy whose definition drifted, but does not count it as matching', () => {
    const drifted = seg('a', 'storeA', { filters: '{"version":1,"logic":"AND","groups":[]}' });
    const plan = planRelink({ source, candidates: [drifted, seg('b', 'storeB')], descendantKeys });
    expect(ids(plan.link)).toEqual(['a', 'b']);
    expect(ids(plan.matching)).toEqual(['b']);
  });

  it('never links a same-named segment outside the group', () => {
    const plan = planRelink({ source, candidates: [seg('x', 'otherGroupStore')], descendantKeys });
    expect(plan.link).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['outside-group']);
  });

  it('leaves a copy that already belongs to another original alone', () => {
    const plan = planRelink({
      source,
      candidates: [seg('a', 'storeA', { sourceAudienceId: 'someoneElse' })],
      descendantKeys,
    });
    expect(plan.link).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['linked-elsewhere']);
  });

  it('reports copies already linked to this source, so a re-run is a no-op', () => {
    const plan = planRelink({
      source,
      candidates: [seg('a', 'storeA', { sourceAudienceId: 'src' })],
      descendantKeys,
    });
    expect(plan.link).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['already-linked']);
  });

  it('skips org-wide segments and ignores differently named ones', () => {
    const plan = planRelink({
      source,
      candidates: [seg('o', null), seg('n', 'storeA', { name: 'Something else' })],
      descendantKeys,
    });
    expect(plan.link).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['org-wide']);
  });

  it('does not treat the source account itself as a copy target', () => {
    const plan = planRelink({ source, candidates: [seg('dup', 'group')], descendantKeys });
    expect(plan.link).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['outside-group']);
  });
});
