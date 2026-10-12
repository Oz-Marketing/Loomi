import { describe, expect, it } from 'vitest';
import { canReadBlast, canUseAccount, confinedAccountKeys } from './blast-access';

const scopedAdmin = { role: 'admin', accountKeys: ['a1'] };
const agencyAdmin = { role: 'admin', accountKeys: [] };
const client = { role: 'client', accountKeys: ['a1'] };

describe('confinedAccountKeys', () => {
  it('confines clients and account-scoped admins only', () => {
    expect(confinedAccountKeys(client)).toEqual(['a1']);
    expect(confinedAccountKeys(scopedAdmin)).toEqual(['a1']);
    expect(confinedAccountKeys(agencyAdmin)).toBeNull();
    expect(confinedAccountKeys({ role: 'super_admin', accountKeys: ['a1'] })).toBeNull();
    expect(confinedAccountKeys({ role: 'client' })).toEqual([]);
  });
});

// The read routes only checked the client role, so an account-scoped admin
// could open (and list) other accounts' blasts.
describe('canReadBlast', () => {
  it('limits an account-scoped admin to their accounts', () => {
    expect(canReadBlast(scopedAdmin, ['a1'])).toBe(true);
    expect(canReadBlast(scopedAdmin, ['a2'])).toBe(false);
  });

  it('matches the write routes on account-less blasts', () => {
    expect(canReadBlast(scopedAdmin, [])).toBe(true);
    expect(canReadBlast(client, [])).toBe(false);
  });

  it('leaves unscoped staff unrestricted', () => {
    expect(canReadBlast(agencyAdmin, ['a2'])).toBe(true);
    expect(canReadBlast({ role: 'developer' }, ['a2'])).toBe(true);
  });

  it('confines a client with no accounts to nothing', () => {
    expect(canReadBlast({ role: 'client', accountKeys: [] }, ['a1'])).toBe(false);
  });
});

describe('canUseAccount', () => {
  it('checks a named account against the user’s scope', () => {
    expect(canUseAccount(scopedAdmin, 'a1')).toBe(true);
    expect(canUseAccount(scopedAdmin, 'a2')).toBe(false);
    expect(canUseAccount(agencyAdmin, 'a2')).toBe(true);
  });
});
