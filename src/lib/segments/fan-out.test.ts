import { describe, it, expect } from 'vitest';
import { findNameClashes, partitionTargets, summarizeFanOut } from './fan-out';

describe('partitionTargets — who may be written to', () => {
  it('lets a privileged caller write anywhere', () => {
    const { allowed, denied } = partitionTargets({
      requested: ['youngChev', 'pjfCorp'],
      writableKeys: [],
      isPrivileged: true,
    });
    expect(allowed).toEqual(['youngChev', 'pjfCorp']);
    expect(denied).toEqual([]);
  });

  it('holds a scoped caller to their assigned accounts', () => {
    // The same rule POST /api/audiences already applies one account at a time.
    // A looser rule here would be a way to reach accounts the single-account
    // path refuses.
    const { allowed, denied } = partitionTargets({
      requested: ['youngChev', 'someoneElse'],
      writableKeys: ['youngChev'],
      isPrivileged: false,
    });
    expect(allowed).toEqual(['youngChev']);
    expect(denied).toEqual(['someoneElse']);
  });

  it('de-dupes and drops blanks without reporting them as denials', () => {
    // Duplicates and empty strings are a client serialization artifact, not a
    // decision the user made — surfacing them as "not authorised" would be a
    // confusing 403 about an account they never picked.
    const { allowed, denied } = partitionTargets({
      requested: ['youngChev', 'youngChev', '  ', '', ' pjfCorp '],
      writableKeys: ['youngChev', 'pjfCorp'],
      isPrivileged: false,
    });
    expect(allowed).toEqual(['youngChev', 'pjfCorp']);
    expect(denied).toEqual([]);
  });

  it('an empty request allows nothing rather than everything', () => {
    // Fail closed: an empty target list must not be read as "all accounts".
    expect(partitionTargets({ requested: [], writableKeys: ['a'], isPrivileged: true }))
      .toEqual({ allowed: [], denied: [] });
  });
});

describe('findNameClashes — the 409 that replaces a raw 500', () => {
  const rows = [
    { name: 'Lapsed Owners', accountKey: 'youngChev' },
    { name: 'Recent Buyers', accountKey: 'pjfCorp' },
  ];

  it('names the accounts that already hold the name', () => {
    expect(findNameClashes('Lapsed Owners', ['youngChev', 'pjfCorp'], rows)).toEqual([
      'youngChev',
    ]);
  });

  it('is case- and whitespace-insensitive', () => {
    // Postgres would reject "  lapsed owners  " as a duplicate of the existing
    // row only if it matched exactly — but the user reads them as the same
    // name, so a pre-flight that missed this would hand back a 500 anyway.
    expect(findNameClashes('  lapsed owners ', ['youngChev'], rows)).toEqual(['youngChev']);
  });

  it('returns nothing when the name is free everywhere', () => {
    expect(findNameClashes('Brand New Segment', ['youngChev', 'pjfCorp'], rows)).toEqual([]);
  });

  it('does NOT count an org-wide segment as a clash', () => {
    // Postgres treats NULLs as distinct in a unique index, so an org-wide
    // "Lapsed Owners" genuinely does not stop an account having its own.
    // Blocking on it would refuse a create the database would have accepted.
    const withOrgWide = [...rows, { name: 'Lapsed Owners', accountKey: null }];
    expect(findNameClashes('Lapsed Owners', ['pjfCorp'], withOrgWide)).toEqual([]);
  });

  it('ignores an empty name', () => {
    expect(findNameClashes('   ', ['youngChev'], rows)).toEqual([]);
  });
});

describe('summarizeFanOut — the three-branch result', () => {
  const label = (key: string) => (key === 'youngChev' ? 'Young Chev' : key);

  it('reports a clean run', () => {
    const { tone, message } = summarizeFanOut(
      { created: [{ accountKey: 'a', id: '1' }, { accountKey: 'b', id: '2' }], failures: [] },
      label,
    );
    expect(tone).toBe('success');
    expect(message).toBe('Segment created in 2 accounts.');
  });

  it('singularizes one account', () => {
    const { message } = summarizeFanOut(
      { created: [{ accountKey: 'a', id: '1' }], failures: [] },
      label,
    );
    expect(message).toBe('Segment created in 1 account.');
  });

  it('warns on a mixed run and names what failed', () => {
    const { tone, message } = summarizeFanOut(
      {
        created: [{ accountKey: 'a', id: '1' }],
        failures: [{ accountKey: 'youngChev', error: 'boom' }],
      },
      label,
    );
    expect(tone).toBe('warning');
    // The display name, not the key — a key in a toast reads as a system error.
    expect(message).toContain('Young Chev');
    expect(message).toContain('1 failed');
  });

  it('errors when nothing was created, carrying the reason', () => {
    const { tone, message } = summarizeFanOut(
      { created: [], failures: [{ accountKey: 'youngChev', error: 'name taken' }] },
      label,
    );
    expect(tone).toBe('error');
    expect(message).toContain('Young Chev: name taken');
  });

  it('errors on an empty result without inventing a reason', () => {
    const { tone, message } = summarizeFanOut({ created: [], failures: [] });
    expect(tone).toBe('error');
    expect(message).toBe('No segments were created.');
  });
});
