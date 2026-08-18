import { describe, it, expect } from 'vitest';
import { checkAssetCopy, checkScopeMove, describeScope, isUnrestrictedAdmin } from './media';

/**
 * Scope is the one media operation whose blast radius exceeds its own row: it
 * changes who can SEE an asset. The rules get tested rather than eyeballed.
 */

const admin = { user: { role: 'admin', accountKeys: [] as string[] } };
const developer = { user: { role: 'developer', accountKeys: [] as string[] } };
const scopedAdmin = { user: { role: 'admin', accountKeys: ['youngHondaOgden'] } };
const client = { user: { role: 'client', accountKeys: ['youngHondaOgden'] } };

const ownedAsset = { accountKey: 'youngHondaOgden', oem: null, managedBy: null };
const sharedAsset = { accountKey: null, oem: 'Honda', managedBy: null };
const globalAsset = { accountKey: null, oem: null, managedBy: null };
const logoAsset = { accountKey: 'youngHondaOgden', oem: null, managedBy: 'account-logo' };

describe('isUnrestrictedAdmin', () => {
  it('is true for developers and admins with no account grants', () => {
    expect(isUnrestrictedAdmin(developer)).toBe(true);
    expect(isUnrestrictedAdmin(admin)).toBe(true);
  });

  it('is false for an admin scoped to specific accounts, and for clients', () => {
    expect(isUnrestrictedAdmin(scopedAdmin)).toBe(false);
    expect(isUnrestrictedAdmin(client)).toBe(false);
  });
});

describe('checkScopeMove', () => {
  it('allows promoting a rooftop asset to its OEM library', () => {
    expect(checkScopeMove(admin, ownedAsset, { accountKey: null, oem: 'Honda' }).error).toBeNull();
  });

  it('allows handing a shared asset to one account, and promoting to global', () => {
    expect(checkScopeMove(admin, sharedAsset, { accountKey: 'youngHondaOgden', oem: null }).error).toBeNull();
    expect(checkScopeMove(admin, sharedAsset, { accountKey: null, oem: null }).error).toBeNull();
  });

  it('allows correcting a wrong brand', () => {
    expect(checkScopeMove(admin, sharedAsset, { accountKey: null, oem: 'Acura' }).error).toBeNull();
  });

  it('refuses anyone who is not an unrestricted admin', () => {
    // Promoting one rooftop's asset publishes it to every other rooftop on that
    // brand — not a decision a single rooftop's user makes for the others.
    for (const s of [scopedAdmin, client]) {
      const r = checkScopeMove(s, ownedAsset, { accountKey: null, oem: 'Honda' });
      expect(r.error).toContain('agency admins');
    }
  });

  it('refuses to move a managed logo or font', () => {
    // Account settings owns these; the next sync would undo the move anyway.
    const r = checkScopeMove(admin, logoAsset, { accountKey: null, oem: 'Honda' });
    expect(r.error).toContain('Account settings');
  });

  it('refuses a target that is both an account and a brand', () => {
    // Not a real scope: `oem` on an account-owned asset is descriptive only, so
    // this would imply a sharing the resolution rule never provides.
    const r = checkScopeMove(admin, ownedAsset, { accountKey: 'youngHondaOgden', oem: 'Honda' });
    expect(r.error).toContain('one account or to a brand');
  });

  it('refuses a no-op move', () => {
    expect(checkScopeMove(admin, sharedAsset, { accountKey: null, oem: 'Honda' }).error)
      .toContain('already');
    expect(checkScopeMove(admin, globalAsset, { accountKey: null, oem: null }).error)
      .toContain('already');
  });

  it('treats undefined and null the same when comparing the current scope', () => {
    const loose = { accountKey: null, oem: undefined as unknown as null, managedBy: null };
    expect(checkScopeMove(admin, loose, { accountKey: null, oem: null }).error).toContain('already');
  });
});

describe('describeScope', () => {
  it('names the destination in words a person would use', () => {
    expect(describeScope({ accountKey: null, oem: 'Honda' })).toBe('every Honda account');
    expect(describeScope({ accountKey: null, oem: null })).toContain('every account');
    expect(describeScope({ accountKey: 'youngHondaOgden', oem: null }, 'Young Honda Ogden'))
      .toBe('Young Honda Ogden');
  });

  it('falls back to the key when the dealer name is unknown', () => {
    expect(describeScope({ accountKey: 'youngHondaOgden', oem: null })).toBe('youngHondaOgden');
  });
});

/**
 * Copy is the sibling of a move, and it exists so one rooftop can take the
 * asset another rooftop owns without a cross-account browsing view. Its rules
 * key off where the copy LANDS, which is what makes it usable by a restricted
 * admin where a move isn't.
 */
describe('checkAssetCopy', () => {
  const otherAccount = { accountKey: 'youngFordOgden', oem: null, managedBy: null };

  it('lets an agency admin copy one rooftop’s asset to another rooftop', () => {
    expect(checkAssetCopy(admin, ownedAsset, { accountKey: 'youngFordOgden', oem: null }).error)
      .toBeNull();
  });

  it('lets a rooftop take its own copy of a shared or Loomi-library asset', () => {
    // The main reason copy exists: the shared original stays put, the rooftop
    // gets one it can rename, re-approve or delete on its own.
    expect(checkAssetCopy(admin, sharedAsset, { accountKey: 'youngHondaOgden', oem: null }).error)
      .toBeNull();
    expect(checkAssetCopy(admin, globalAsset, { accountKey: 'youngHondaOgden', oem: null }).error)
      .toBeNull();
  });

  it('lets a restricted admin copy into an account they hold — unlike a move', () => {
    expect(checkAssetCopy(scopedAdmin, sharedAsset, { accountKey: 'youngHondaOgden', oem: null }).error)
      .toBeNull();
  });

  it('refuses a restricted admin copying into an account they don’t hold', () => {
    expect(checkAssetCopy(scopedAdmin, sharedAsset, { accountKey: 'youngFordOgden', oem: null }).error)
      .toContain('access to that account');
  });

  it('refuses a restricted admin reading another account’s asset', () => {
    expect(checkAssetCopy(scopedAdmin, otherAccount, { accountKey: 'youngHondaOgden', oem: null }).error)
      .toContain('access to that asset');
  });

  it('holds the shared libraries to the same bar a move does', () => {
    // Copying INTO the Loomi library or a brand publishes to every account, so
    // it stays an unrestricted-admin decision.
    expect(checkAssetCopy(scopedAdmin, ownedAsset, { accountKey: null, oem: 'Honda' }).error)
      .toContain('agency admins');
    expect(checkAssetCopy(admin, ownedAsset, { accountKey: null, oem: 'Honda' }).error).toBeNull();
  });

  it('refuses clients outright', () => {
    expect(checkAssetCopy(client, sharedAsset, { accountKey: 'youngHondaOgden', oem: null }).error)
      .toContain('Clients');
  });

  it('refuses managed logos and fonts, which Account settings owns', () => {
    expect(checkAssetCopy(admin, logoAsset, { accountKey: 'youngFordOgden', oem: null }).error)
      .toContain('Account settings');
  });

  it('refuses copying into the scope the asset already lives in', () => {
    expect(checkAssetCopy(admin, ownedAsset, { accountKey: 'youngHondaOgden', oem: null }).error)
      .toContain('already lives');
    expect(checkAssetCopy(admin, sharedAsset, { accountKey: null, oem: 'Honda' }).error)
      .toContain('already lives');
  });

  it('refuses the both-at-once scope the API rejects', () => {
    expect(checkAssetCopy(admin, ownedAsset, { accountKey: 'youngFordOgden', oem: 'Honda' }).error)
      .toContain('one account or to a brand');
  });
});
