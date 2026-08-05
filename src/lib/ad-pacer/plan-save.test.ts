import { describe, it, expect } from 'vitest';
import { isPlanAlignedWith, misplacedAdRows, serializePlanSave } from './plan-save';
import type { AdRowOwner } from './plan-save';
import type { PacerAd, PacerPlan } from './types';

// The bug these guard: the pacer autosave is a full-replace PUT scoped by the
// account + month in the query string. Scrolling through months (or sitting on
// the Reconciliation tab while a plan load raced or failed) could leave `plan`
// holding one month while `period` pointed at another — the save then deleted
// the month on screen and re-parented the other month's rows into it, so BOTH
// months lost their data.

const ACCOUNT = 'young-powersports-euro';

function mkAd(overrides: Partial<PacerAd>): PacerAd {
  return {
    id: 'ad-1',
    position: 0,
    name: 'Bike Night Event',
    period: '2026-06',
    allocation: '80.00',
    ...overrides,
  } as unknown as PacerAd;
}

function mkPlan(overrides: Partial<PacerPlan>): PacerPlan {
  return {
    accountKey: ACCOUNT,
    period: '2026-06',
    baseBudgetGoal: '1540.00',
    addedBudgetGoal: null,
    ads: [],
    ...overrides,
  } as unknown as PacerPlan;
}

describe('serializePlanSave', () => {
  it("stamps every ad with the plan's OWN period, not a stale one", () => {
    const plan = mkPlan({
      period: '2026-07',
      ads: [mkAd({ id: 'a', period: '2026-06' }), mkAd({ id: 'b', period: '' })],
    });
    const body = JSON.parse(serializePlanSave(plan));
    expect(body.ads.map((a: PacerAd) => a.period)).toEqual(['2026-07', '2026-07']);
  });

  it('renumbers positions to the rendered order', () => {
    const plan = mkPlan({
      ads: [mkAd({ id: 'a', position: 7 }), mkAd({ id: 'b', position: 3 })],
    });
    const body = JSON.parse(serializePlanSave(plan));
    expect(body.ads.map((a: PacerAd) => [a.id, a.position])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });

  it('sends only the budget goals and ads (never the derived/frozen fields)', () => {
    const plan = mkPlan({ frozen: true, markup: 0.3, ads: [mkAd({})] });
    expect(Object.keys(JSON.parse(serializePlanSave(plan))).sort()).toEqual([
      'addedBudgetGoal',
      'ads',
      'baseBudgetGoal',
    ]);
  });

  it('is stable for the same plan, so a re-loaded month is not written back', () => {
    const plan = mkPlan({ ads: [mkAd({})] });
    expect(serializePlanSave(plan)).toBe(serializePlanSave(mkPlan({ ads: [mkAd({})] })));
  });
});

describe('isPlanAlignedWith', () => {
  it('allows the save when the plan is the account + month on screen', () => {
    expect(isPlanAlignedWith(mkPlan({}), ACCOUNT, '2026-06')).toBe(true);
  });

  it('blocks a plan left over from another month (the wipe/transfer case)', () => {
    expect(isPlanAlignedWith(mkPlan({ period: '2026-06' }), ACCOUNT, '2026-07')).toBe(
      false,
    );
  });

  it('blocks a plan left over from another account', () => {
    expect(isPlanAlignedWith(mkPlan({}), 'young-chevrolet', '2026-06')).toBe(false);
  });

  it('blocks when there is no plan or no account yet', () => {
    expect(isPlanAlignedWith(null, ACCOUNT, '2026-06')).toBe(false);
    expect(isPlanAlignedWith(mkPlan({}), null, '2026-06')).toBe(false);
  });
});

describe('misplacedAdRows', () => {
  const target = { planId: 'plan-1', period: '2026-07', platform: 'meta' as const };
  const row = (o: Partial<AdRowOwner>): AdRowOwner => ({
    id: 'ad-1',
    planId: 'plan-1',
    period: '2026-07',
    platform: null,
    ...o,
  });

  it('passes rows that already live in the target scope', () => {
    expect(
      misplacedAdRows([row({}), row({ id: 'ad-2', platform: 'meta' })], target),
    ).toEqual([]);
  });

  it('flags rows belonging to another month', () => {
    expect(misplacedAdRows([row({ period: '2026-06' })], target)).toHaveLength(1);
  });

  it('flags rows belonging to another account', () => {
    expect(misplacedAdRows([row({ planId: 'plan-2' })], target)).toHaveLength(1);
  });

  it('flags rows belonging to the other platform, both directions', () => {
    expect(misplacedAdRows([row({ platform: 'google' })], target)).toHaveLength(1);
    expect(
      misplacedAdRows([row({ platform: null })], { ...target, platform: 'google' }),
    ).toHaveLength(1);
  });

  it('treats legacy null platform as Meta', () => {
    expect(misplacedAdRows([row({ platform: null })], target)).toEqual([]);
  });
});
