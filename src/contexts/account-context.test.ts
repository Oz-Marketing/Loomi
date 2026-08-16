import { describe, it, expect } from 'vitest';
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
