import { describe, it, expect } from 'vitest';
import {
  countOutOfLicence,
  isOutOfLicence,
  orderPickerAssets,
  pickerRank,
  type PickableAsset,
} from './media-picker-order';

/**
 * This is the code standing between a lapsed licence and a live ad, so it gets
 * tested rather than eyeballed.
 */

const asset = (
  name: string,
  status?: string | null,
  rights?: PickableAsset['rights'],
): PickableAsset => ({ name, status, rights });

const approved = asset('approved.jpg', 'approved');
const draft = asset('draft.jpg', 'draft');
const lapsedApproved = asset('lapsed.jpg', 'approved', { status: 'expired', daysRemaining: -9 });
const expiringApproved = asset('soon.jpg', 'approved', { status: 'expiring_soon', daysRemaining: 11 });
const legacy = asset('legacy.jpg', null);

describe('isOutOfLicence', () => {
  it('covers both past-date states', () => {
    expect(isOutOfLicence(lapsedApproved)).toBe(true);
    expect(isOutOfLicence(asset('x', 'approved', { status: 'lapsed', daysRemaining: -40 }))).toBe(true);
  });

  it('does not flag an asset that is merely close, or one with no licence recorded', () => {
    expect(isOutOfLicence(expiringApproved)).toBe(false);
    expect(isOutOfLicence(approved)).toBe(false);
    expect(isOutOfLicence(asset('x', 'approved', { status: 'unknown', daysRemaining: null }))).toBe(false);
  });
});

describe('pickerRank', () => {
  it('puts cleared work first and drafts second', () => {
    expect(pickerRank(approved)).toBeLessThan(pickerRank(draft));
  });

  it('ranks an approved-but-lapsed asset BELOW an honest draft', () => {
    // It's the more dangerous of the two: the approval would otherwise vouch
    // for something that is no longer licensed.
    expect(pickerRank(lapsedApproved)).toBeGreaterThan(pickerRank(draft));
  });
});

describe('orderPickerAssets', () => {
  it('sorts approved → draft → out of licence', () => {
    const out = orderPickerAssets(
      [lapsedApproved, draft, approved],
      { approvedOnly: false },
    );
    expect(out.map((a) => a.name)).toEqual(['approved.jpg', 'draft.jpg', 'lapsed.jpg']);
  });

  it('hides nothing by default — a vanished asset reads as a bug', () => {
    const out = orderPickerAssets([lapsedApproved, draft, approved], { approvedOnly: false });
    expect(out).toHaveLength(3);
  });

  it('drops drafts when approvedOnly is on', () => {
    const out = orderPickerAssets([draft, approved], { approvedOnly: true });
    expect(out.map((a) => a.name)).toEqual(['approved.jpg']);
  });

  it('keeps status-less legacy assets even under approvedOnly', () => {
    // Assets predating the lifecycle column would otherwise disappear the
    // moment someone ticks the box, which looks like data loss.
    const out = orderPickerAssets([legacy, draft], { approvedOnly: true });
    expect(out.map((a) => a.name)).toEqual(['legacy.jpg']);
  });

  it('still surfaces an out-of-licence asset under approvedOnly — it IS approved', () => {
    // Deliberate: approvedOnly filters on approval, not rights. It's sorted last
    // and badged, and the warning strip is what speaks to the licence.
    const out = orderPickerAssets([lapsedApproved], { approvedOnly: true });
    expect(out).toHaveLength(1);
  });

  it('applies the search to filenames', () => {
    const out = orderPickerAssets([approved, draft], { approvedOnly: false, search: 'DRA' });
    expect(out.map((a) => a.name)).toEqual(['draft.jpg']);
  });

  it('composes search with approvedOnly', () => {
    const out = orderPickerAssets([approved, draft], { approvedOnly: true, search: 'dra' });
    expect(out).toEqual([]);
  });

  it('does not mutate its input', () => {
    const input = [lapsedApproved, approved];
    orderPickerAssets(input, { approvedOnly: false });
    expect(input[0].name).toBe('lapsed.jpg');
  });

  it('is stable within a rank, preserving the server\'s recency order', () => {
    const a = asset('first.jpg', 'approved');
    const b = asset('second.jpg', 'approved');
    expect(orderPickerAssets([a, b], { approvedOnly: false }).map((x) => x.name))
      .toEqual(['first.jpg', 'second.jpg']);
  });
});

describe('countOutOfLicence', () => {
  it('counts only the past-date ones', () => {
    expect(countOutOfLicence([lapsedApproved, expiringApproved, approved, draft])).toBe(1);
    expect(countOutOfLicence([])).toBe(0);
  });
});
