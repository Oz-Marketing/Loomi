import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LIVE_TEMPLATE,
  canAccountUseTemplate,
  isGlobalTemplate,
  parseSharedKeys,
  serializeSharedKeys,
  templateAccessKeys,
  templatesForAccount,
  templatesForAnyAccount,
  templateAudience,
  audienceLabel,
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

  it('does NOT flow a group template down to the accounts beneath it', () => {
    // Inheritance used to make this true, which made "self" a lie: a group
    // choosing itself was publishing to its whole fleet, with no setting that
    // said so and no way to take it back. Reaching a sub-account is now a
    // deliberate share.
    expect(
      canAccountUseTemplate({ accountKey: 'young-group', sharedAccountKeys: null }, {
        accountKey: 'young-subaru',
      }),
    ).toBe(false);
  });

  it('reaches a sub-account once the group actually shares it', () => {
    expect(
      canAccountUseTemplate({ accountKey: 'young-group', sharedAccountKeys: '["young-subaru"]' }, {
        accountKey: 'young-subaru',
      }),
    ).toBe(true);
  });

  it('does not let a share with the group reach the group\u2019s children', () => {
    expect(
      canAccountUseTemplate({ accountKey: 'other-account', sharedAccountKeys: '["young-group"]' }, {
        accountKey: 'young-subaru',
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

describe('LIVE_TEMPLATE (soft delete)', () => {
  it('filters to rows that have not been deleted', () => {
    expect(LIVE_TEMPLATE).toEqual({ deletedAt: null });
  });

  /**
   * The guard that matters. `deletedAt` only means anything if EVERY query that
   * SELECTS templates carries the filter — the library, the automation resolver,
   * the shadow report, the taxonomy facets. Miss one and the template looks
   * deleted in the UI while still quietly feeding unattended generation, which
   * is worse than not having a soft delete at all.
   *
   * A static read of the source rather than a runtime assertion because the call
   * sites are spread across API routes and background jobs that a unit test
   * can't reach. Same shape as the pg-boss `createQueue` guard: cheap, and it
   * fails on the PR that introduces the next unfiltered `findMany`.
   *
   * `findUnique` is deliberately NOT covered — fetch-by-id has to be able to read
   * a deleted row (restore, and an existing ad that still renders from it).
   */
  it('is carried by every findMany that selects templates', () => {
    const root = join(__dirname, '../../..');
    const files = execFileSync(
      'grep',
      ['-rl', '--include=*.ts', 'adTemplateDoc', join(root, 'src')],
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean);

    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      // Each `.findMany({ … })` opened on an adTemplateDoc, with its options up
      // to the matching close of the object literal.
      const re = /adTemplateDoc\s*(?:\r?\n\s*)?\.?\s*\n?\s*\.?findMany\(\{([\s\S]*?)\n\s*\}\)/g;
      for (const m of src.matchAll(re)) {
        const opts = m[1];
        if (!opts.includes('LIVE_TEMPLATE') && !opts.includes('deletedAt')) {
          offenders.push(`${file.replace(root + '/', '')}: ${opts.trim().slice(0, 60)}…`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('templateAudience', () => {
  const name = (k: string) => ({ 'young-subaru': 'Young Subaru', 'young-chev': 'Young Chevrolet', 'young-kia': 'Young Kia' })[k] ?? k;

  it('is everyone only for an unowned, unshared template', () => {
    expect(templateAudience(global)).toEqual({ kind: 'all' });
    expect(audienceLabel(global, name)).toBe('All accounts');
  });

  it('narrows a shared-library template to exactly who it was shared with', () => {
    // The bug this exists to prevent: the card used to read `accountKey` alone
    // and call this one "All accounts" while the access rule allowed one dealer.
    expect(templateAudience(globalButShared)).toEqual({ kind: 'accounts', keys: ['young-chev'] });
    expect(audienceLabel(globalButShared, name)).toBe('Young Chevrolet');
  });

  it('names the owner when a template is its account\'s alone', () => {
    expect(templateAudience(owned)).toEqual({ kind: 'accounts', keys: ['young-subaru'] });
    expect(audienceLabel(owned, name)).toBe('Young Subaru');
  });

  it('counts owner plus shared together', () => {
    const a = templateAudience(shared);
    expect(a.kind).toBe('accounts');
    expect(a.kind === 'accounts' && a.keys.sort()).toEqual(['young-chev', 'young-kia', 'young-subaru']);
    expect(audienceLabel(shared, name)).toBe('3 accounts');
  });

  it('agrees with canAccountUseTemplate on every row', () => {
    // The whole point of deriving audience here: the label and the gate cannot
    // drift, because a disagreement fails this test.
    for (const row of [global, owned, shared, globalButShared]) {
      const a = templateAudience(row);
      for (const key of ['young-subaru', 'young-chev', 'young-kia', 'stranger']) {
        const allowed = canAccountUseTemplate(row, { accountKey: key });
        expect(allowed).toBe(a.kind === 'all' || a.keys.includes(key));
      }
    }
  });
});
