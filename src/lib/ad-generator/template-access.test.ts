import { describe, expect, it } from 'vitest';
import {
  canAccountUseTemplate,
  isGlobalTemplate,
  parseSharedKeys,
  serializeSharedKeys,
  templateAccessKeys,
  templatesForAccount,
  templatesForAnyAccount,
} from './template-access';

const global = { accountKey: null, sharedAccountKeys: null };
const owned = { accountKey: 'young-subaru', sharedAccountKeys: null };
const shared = { accountKey: 'young-subaru', sharedAccountKeys: '["young-chev","young-kia"]' };
const globalButShared = { accountKey: null, sharedAccountKeys: '["young-chev"]' };

describe('parseSharedKeys', () => {
  it('reads a stored JSON array', () => {
    expect(parseSharedKeys('["a","b"]')).toEqual(['a', 'b']);
  });

  it('accepts an already-parsed array', () => {
    expect(parseSharedKeys(['a'])).toEqual(['a']);
  });

  it('treats null, junk and non-arrays as nothing shared', () => {
    expect(parseSharedKeys(null)).toEqual([]);
    expect(parseSharedKeys('not json')).toEqual([]);
    expect(parseSharedKeys('{"a":1}')).toEqual([]);
  });

  it('drops blanks and non-strings', () => {
    expect(parseSharedKeys('["a","",null,3]')).toEqual(['a']);
  });
});

describe('templateAccessKeys', () => {
  it('is the owner plus everyone shared with', () => {
    expect(templateAccessKeys(shared).sort()).toEqual(['young-chev', 'young-kia', 'young-subaru']);
  });

  it('does not double-count an owner who is also in the shared list', () => {
    expect(templateAccessKeys({ accountKey: 'a', sharedAccountKeys: '["a"]' })).toEqual(['a']);
  });
});

describe('isGlobalTemplate', () => {
  it('is true only with no owner and nothing shared', () => {
    expect(isGlobalTemplate(global)).toBe(true);
    expect(isGlobalTemplate(owned)).toBe(false);
    expect(isGlobalTemplate(globalButShared)).toBe(false);
  });
});

describe('canAccountUseTemplate', () => {
  it('offers a library template to everyone, including the admin view', () => {
    expect(canAccountUseTemplate(global, { accountKey: 'anyone' })).toBe(true);
    expect(canAccountUseTemplate(global, { accountKey: null })).toBe(true);
  });

  it('keeps an owned template to its owner', () => {
    expect(canAccountUseTemplate(owned, { accountKey: 'young-subaru' })).toBe(true);
    expect(canAccountUseTemplate(owned, { accountKey: 'young-chev' })).toBe(false);
  });

  it('grants the accounts it was shared with', () => {
    expect(canAccountUseTemplate(shared, { accountKey: 'young-chev' })).toBe(true);
    expect(canAccountUseTemplate(shared, { accountKey: 'young-kia' })).toBe(true);
  });

  it('still refuses an account that was never shared with', () => {
    expect(canAccountUseTemplate(shared, { accountKey: 'someone-else' })).toBe(false);
  });

  it('NARROWS a global template once it is shared with anyone', () => {
    // "Toggle who should have access" would mean nothing if the answer stayed
    // "everyone", so sharing a library template restricts it.
    expect(canAccountUseTemplate(globalButShared, { accountKey: 'young-chev' })).toBe(true);
    expect(canAccountUseTemplate(globalButShared, { accountKey: 'young-subaru' })).toBe(false);
  });

  it('inherits a template owned by a group account', () => {
    expect(
      canAccountUseTemplate({ accountKey: 'young-group', sharedAccountKeys: null }, {
        accountKey: 'young-subaru',
        ancestorKeys: ['young-group'],
      }),
    ).toBe(true);
  });

  it('does not let inheritance launder a sibling share', () => {
    // A template shared WITH the group is not the group's to hand down.
    expect(
      canAccountUseTemplate({ accountKey: 'other-rooftop', sharedAccountKeys: '["young-group"]' }, {
        accountKey: 'young-subaru',
        ancestorKeys: ['young-group'],
      }),
    ).toBe(false);
  });

  it('refuses a scoped template when there is no active account', () => {
    expect(canAccountUseTemplate(owned, { accountKey: null })).toBe(false);
  });
});

describe('templatesForAccount', () => {
  it('keeps the library plus what this account owns or was given', () => {
    const rows = [global, owned, shared, globalButShared];
    expect(templatesForAccount(rows, { accountKey: 'young-chev' })).toEqual([global, shared, globalButShared]);
  });
});

describe('templatesForAnyAccount', () => {
  it('unions across a client with more than one subaccount', () => {
    const rows = [global, owned, globalButShared];
    expect(templatesForAnyAccount(rows, ['young-subaru', 'young-chev'])).toEqual(rows);
  });

  it('is just the library for a client with no scopes', () => {
    expect(templatesForAnyAccount([global, owned], [])).toEqual([global]);
  });
});

describe('serializeSharedKeys', () => {
  it('stores a de-duplicated array', () => {
    expect(serializeSharedKeys(['a', 'b', 'a'])).toBe('["a","b"]');
  });

  it('stores null for an empty or invalid list, so scoping falls back to the owner', () => {
    expect(serializeSharedKeys([])).toBeNull();
    expect(serializeSharedKeys(['', '  '])).toBeNull();
    expect(serializeSharedKeys('nope')).toBeNull();
  });
});
