import { describe, it, expect } from 'vitest';
import {
  combinedReach,
  countTopLevel,
  filterKeepingFamilies,
  groupFollowUps,
} from './blast-follow-ups';

const row = (id: string, resendOf?: string) => ({ id, ...(resendOf ? { resendOf } : {}) });
const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

describe('groupFollowUps', () => {
  it('nests a follow-up under its original and keeps list order', () => {
    const { roots, byParent } = groupFollowUps([row('fu', 'a'), row('a'), row('b')]);
    expect(ids(roots)).toEqual(['a', 'b']);
    expect(ids(byParent.get('a') ?? [])).toEqual(['fu']);
  });

  it('keeps a follow-up whose original is not in the list at the top level', () => {
    // An archived original, or one outside this account's list, must not
    // make its follow-up disappear.
    const { roots, byParent } = groupFollowUps([row('fu', 'gone'), row('b')]);
    expect(ids(roots)).toEqual(['fu', 'b']);
    expect(byParent.size).toBe(0);
  });

  it('ignores a row that claims to follow up on itself', () => {
    expect(ids(groupFollowUps([row('a', 'a')]).roots)).toEqual(['a']);
  });
});

describe('filterKeepingFamilies', () => {
  const rows = [row('fu', 'a'), row('a'), row('b')];

  it('pulls in the original when only its follow-up matches', () => {
    expect(ids(filterKeepingFamilies(rows, (r) => r.id === 'fu'))).toEqual(['fu', 'a']);
  });

  it('keeps the follow-up when only the original matches', () => {
    expect(ids(filterKeepingFamilies(rows, (r) => r.id === 'a'))).toEqual(['fu', 'a']);
  });

  it('drops a family when neither half matches', () => {
    expect(ids(filterKeepingFamilies(rows, (r) => r.id === 'b'))).toEqual(['b']);
  });
});

describe('countTopLevel', () => {
  it('counts an original and its follow-up as one campaign', () => {
    expect(countTopLevel([row('fu', 'a'), row('a'), row('b')])).toBe(2);
  });
});

describe('combinedReach', () => {
  it('adds unique opens across sends over the original audience', () => {
    // Young Chevrolet "Buy 3 Tires": 51 of 1,109, then 32 more from the follow-up.
    const reach = combinedReach({ sent: 1109, uniqueOpens: 51 }, [{ sent: 1049, uniqueOpens: 32 }]);
    expect(reach).toEqual({ opened: 83, audience: 1109, openedFirst: 51, rate: 83 / 1109 });
  });

  it('is null until a follow-up has actually sent', () => {
    expect(combinedReach({ sent: 1109, uniqueOpens: 51 }, [])).toBeNull();
    expect(combinedReach({ sent: 1109, uniqueOpens: 51 }, [undefined])).toBeNull();
    expect(combinedReach({ sent: 1109, uniqueOpens: 51 }, [{ sent: 0, uniqueOpens: 0 }])).toBeNull();
  });

  it('is null without the original numbers', () => {
    expect(combinedReach(undefined, [{ sent: 10, uniqueOpens: 2 }])).toBeNull();
  });
});
