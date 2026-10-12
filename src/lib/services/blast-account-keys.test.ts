import { describe, expect, it } from 'vitest';
import { BLAST_ACCOUNT_REQUIRED, parseBlastAccountKeys } from './blast-account-keys';

describe('parseBlastAccountKeys', () => {
  it('keeps the account a blast was created for', () => {
    expect(parseBlastAccountKeys(['youngPowersports'])).toEqual({ ok: true, keys: ['youngPowersports'] });
  });

  it('refuses a blast with no account — it would show in every account', () => {
    for (const raw of [[], undefined, null, '', [''], ['  '], [null, 3]]) {
      expect(parseBlastAccountKeys(raw)).toEqual({ ok: false, error: BLAST_ACCOUNT_REQUIRED });
    }
  });

  it('drops duplicates and non-strings', () => {
    expect(parseBlastAccountKeys(['a', 'a', 7, 'b'])).toEqual({ ok: true, keys: ['a', 'b'] });
  });
});
