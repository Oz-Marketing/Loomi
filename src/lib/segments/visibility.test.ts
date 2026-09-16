import { describe, it, expect } from 'vitest';
import {
  canWriteSegment,
  isInheritedFromGroup,
  isSegmentVisibleTo,
  segmentReadWhere,
  viewerScope,
} from './visibility';
import type { AccountEdge } from '@/lib/account-hierarchy';

// group ── rooftopA
//      └── rooftopB
// other (unrelated root)
const EDGES: AccountEdge[] = [
  { key: 'group', parentAccountKey: null },
  { key: 'rooftopA', parentAccountKey: 'group' },
  { key: 'rooftopB', parentAccountKey: 'group' },
  { key: 'other', parentAccountKey: null },
];

const atGroup = viewerScope(EDGES, 'group');
const atRooftopA = viewerScope(EDGES, 'rooftopA');
const atOther = viewerScope(EDGES, 'other');
const atAllAccounts = viewerScope(EDGES, null);

const groupOwn = { accountKey: 'group', sharedWithChildren: false };
const groupShared = { accountKey: 'group', sharedWithChildren: true };
const rooftopOwn = { accountKey: 'rooftopA', sharedWithChildren: false };
const orgWide = { accountKey: null, sharedWithChildren: false };

describe('segment visibility', () => {
  it('shows an account its own segments', () => {
    expect(isSegmentVisibleTo(rooftopOwn, atRooftopA)).toBe(true);
    expect(isSegmentVisibleTo(groupOwn, atGroup)).toBe(true);
  });

  it('shows platform-wide segments everywhere', () => {
    for (const viewer of [atGroup, atRooftopA, atOther]) {
      expect(isSegmentVisibleTo(orgWide, viewer)).toBe(true);
    }
  });

  // The regression this whole change exists to fix.
  it('does NOT show a group its rooftops segments', () => {
    expect(isSegmentVisibleTo(rooftopOwn, atGroup)).toBe(false);
  });

  it('shares DOWN only when the flag is set', () => {
    expect(isSegmentVisibleTo(groupShared, atRooftopA)).toBe(true);
    expect(isSegmentVisibleTo(groupOwn, atRooftopA)).toBe(false);
  });

  it('does not leak a shared segment sideways to an unrelated account', () => {
    expect(isSegmentVisibleTo(groupShared, atOther)).toBe(false);
  });

  it('shows everything in the all-accounts overview', () => {
    expect(isSegmentVisibleTo(rooftopOwn, atAllAccounts)).toBe(true);
    expect(isSegmentVisibleTo(groupOwn, atAllAccounts)).toBe(true);
  });

  it('marks a received segment as inherited, but not the owner’s own copy', () => {
    expect(isInheritedFromGroup(groupShared, atRooftopA)).toBe(true);
    expect(isInheritedFromGroup(groupShared, atGroup)).toBe(false);
    expect(isInheritedFromGroup(orgWide, atRooftopA)).toBe(false);
  });
});

describe('read scope SQL mirrors the predicate', () => {
  it('includes own, platform-wide and shared-from-ancestor', () => {
    expect(segmentReadWhere(['rooftopA'], ['group'])).toEqual({
      OR: [
        { accountKey: null },
        { accountKey: { in: ['rooftopA'] } },
        { accountKey: { in: ['group'] }, sharedWithChildren: true },
      ],
    });
  });

  it('omits the ancestor clause for a root account', () => {
    expect(segmentReadWhere(['group'], [])).toEqual({
      OR: [{ accountKey: null }, { accountKey: { in: ['group'] } }],
    });
  });
});

describe('write access', () => {
  const rooftopUser = { role: 'admin', accountKeys: ['rooftopA'] };
  const groupUser = { role: 'admin', accountKeys: ['group'] };
  const dev = { role: 'developer', accountKeys: [] };

  it('lets an account edit its own segment', () => {
    expect(canWriteSegment(rooftopOwn, rooftopUser)).toBeNull();
  });

  // The read-only half of "read-only, with Duplicate".
  it('refuses a rooftop editing the group’s shared segment', () => {
    expect(canWriteSegment(groupShared, rooftopUser)).toBe('inherited_read_only');
  });

  it('still lets the owning group edit what it shared', () => {
    expect(canWriteSegment(groupShared, groupUser)).toBeNull();
  });

  it('keeps platform-wide segments privileged', () => {
    expect(canWriteSegment(orgWide, rooftopUser)).toBe('org_wide_requires_privilege');
    expect(canWriteSegment(orgWide, dev)).toBeNull();
  });

  it('refuses an unrelated account outright', () => {
    expect(canWriteSegment(rooftopOwn, { role: 'admin', accountKeys: ['other'] })).toBe(
      'not_in_scope',
    );
  });
});
