import { describe, it, expect } from 'vitest';
import { nextSelfScope, parseSelfScope } from '@/lib/active-account';
import { resolveDefaultAccountKey } from './account-context';
import type { AccountData } from './account-context';

// Agency scope used to be where a user with no stored selection landed. It isn't
// a place any more (see docs/settings-architecture.md), so the context has to
// pick a sub-account instead — and if it picks nothing, the user sits in a scope
// the switcher can neither name nor leave. These lock the choice.

const account = (dealer: string): AccountData => ({
  dealer,
  logos: { light: '', dark: '' },
});

describe('resolveDefaultAccountKey', () => {
  it('returns null when the user can see no accounts', () => {
    expect(resolveDefaultAccountKey({}, {})).toBeNull();
  });

  it('prefers an Organization — it rolls its rooftops up, so it is the widest view left', () => {
    const accounts = {
      aRooftop: account('A Rooftop'),
      youngAutomotiveGroup: account('Young Automotive Group'),
      zRooftop: account('Z Rooftop'),
    };
    expect(resolveDefaultAccountKey(accounts, { youngAutomotiveGroup: 31 })).toBe(
      'youngAutomotiveGroup',
    );
  });

  it('picks the largest Organization when there are several', () => {
    const accounts = {
      youngAutomotiveGroup: account('Young Automotive Group'),
      youngPowersports: account('Young Powersports'),
    };
    expect(
      resolveDefaultAccountKey(accounts, { youngAutomotiveGroup: 31, youngPowersports: 8 }),
    ).toBe('youngAutomotiveGroup');
  });

  it('falls back to the first account by display name when nothing rolls up', () => {
    const accounts = {
      zebra: account('Zebra Motors'),
      apex: account('Apex Motors'),
    };
    expect(resolveDefaultAccountKey(accounts, {})).toBe('apex');
  });

  it('is stable between loads — equal-sized orgs break the tie by name, not key order', () => {
    const accounts = {
      zGroup: account('Z Group'),
      aGroup: account('A Group'),
    };
    const forwards = resolveDefaultAccountKey(accounts, { zGroup: 4, aGroup: 4 });
    const backwards = resolveDefaultAccountKey(
      { aGroup: accounts.aGroup, zGroup: accounts.zGroup },
      { aGroup: 4, zGroup: 4 },
    );
    expect(forwards).toBe('aGroup');
    expect(backwards).toBe('aGroup');
  });
});

describe('roll-up vs self scope (a group viewed as itself)', () => {
  // The bug the toggle exists for: `isGroup` is derived from "has children", so
  // it can never be false for Young Automotive Group — and every report keyed off
  // it, which made YAG's OWN campaigns unreachable the moment a rooftop pointed
  // at it. These lock in the invariants that keep that from coming back.

  it('rolls up by default — only the exceptions are stored', () => {
    // Nothing stored means every group rolls up, so a group created tomorrow
    // needs no row and clearing the cookie restores pre-toggle behavior.
    expect(parseSelfScope(null).size).toBe(0);
    expect(parseSelfScope('').size).toBe(0);
    expect(parseSelfScope('yag').has('yag')).toBe(true);
  });

  it('pins one account without disturbing another', () => {
    const one = nextSelfScope(new Set(), 'yag', true);
    expect(parseSelfScope(one).has('yag')).toBe(true);

    const two = nextSelfScope(parseSelfScope(one), 'other-group', true);
    expect(parseSelfScope(two).has('yag')).toBe(true);
    expect(parseSelfScope(two).has('other-group')).toBe(true);
  });

  it('unpinning one leaves the other pinned — the choice is per group', () => {
    const both = parseSelfScope(nextSelfScope(new Set(['yag']), 'other-group', true));
    const after = nextSelfScope(both, 'yag', false);
    expect(parseSelfScope(after).has('yag')).toBe(false);
    expect(parseSelfScope(after).has('other-group')).toBe(true);
  });

  it('is idempotent, so a double click cannot duplicate a key', () => {
    const once = nextSelfScope(new Set(), 'yag', true);
    const twice = nextSelfScope(parseSelfScope(once), 'yag', true);
    expect(twice).toBe('yag');
  });
});
