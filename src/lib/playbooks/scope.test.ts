import { describe, it, expect } from 'vitest';
import { parseRequestedKeys, resolveAuditScope } from './scope';

/**
 * The audit endpoint enumerates every configured value on every account it is
 * handed — ad account ids, pixel ids, Google customer ids, sender domains. So
 * the only thing standing between a restricted admin and the whole roster is
 * this intersection, and nothing on screen would change if it silently stopped
 * intersecting.
 *
 * `ROSTER` stands in for the account table in render order.
 */
const ROSTER = ['youngChev', 'youngFord', 'youngHonda', 'youngKia'];

describe('parseRequestedKeys', () => {
  it('reads a comma-separated param', () => {
    expect(parseRequestedKeys('youngChev,youngFord')).toEqual(['youngChev', 'youngFord']);
  });

  it('tolerates the spacing and trailing commas a hand-written URL carries', () => {
    expect(parseRequestedKeys(' youngChev , youngFord ,,')).toEqual(['youngChev', 'youngFord']);
  });

  it('reads absent and empty as no request at all', () => {
    expect(parseRequestedKeys(null)).toEqual([]);
    expect(parseRequestedKeys('')).toEqual([]);
    expect(parseRequestedKeys(',, ,')).toEqual([]);
  });
});

describe('resolveAuditScope', () => {
  it('gives an unrestricted role the whole roster when nothing is requested', () => {
    expect(
      resolveAuditScope({
        allAccountKeys: ROSTER,
        role: 'super_admin',
        sessionAccountKeys: [],
        requestedParam: null,
      }),
    ).toEqual(ROSTER);
  });

  it('gives a RESTRICTED admin only its own grants, not the roster', () => {
    expect(
      resolveAuditScope({
        allAccountKeys: ROSTER,
        role: 'admin',
        sessionAccountKeys: ['youngHonda'],
        requestedParam: null,
      }),
    ).toEqual(['youngHonda']);
  });

  it('narrows to the requested keys inside what the session may see', () => {
    expect(
      resolveAuditScope({
        allAccountKeys: ROSTER,
        role: 'super_admin',
        sessionAccountKeys: [],
        requestedParam: 'youngFord,youngKia',
      }),
    ).toEqual(['youngFord', 'youngKia']);
  });

  // The one that matters: a restricted admin hand-editing the query string.
  it('refuses a requested key the session may not see', () => {
    expect(
      resolveAuditScope({
        allAccountKeys: ROSTER,
        role: 'admin',
        sessionAccountKeys: ['youngHonda'],
        requestedParam: 'youngChev,youngFord,youngKia',
      }),
    ).toEqual([]);
  });

  it('keeps only the permitted half of a mixed request', () => {
    expect(
      resolveAuditScope({
        allAccountKeys: ROSTER,
        role: 'admin',
        sessionAccountKeys: ['youngHonda', 'youngKia'],
        requestedParam: 'youngChev,youngHonda',
      }),
    ).toEqual(['youngHonda']);
  });

  it('drops a key that does not exist rather than echoing it back', () => {
    expect(
      resolveAuditScope({
        allAccountKeys: ROSTER,
        role: 'super_admin',
        sessionAccountKeys: [],
        requestedParam: 'youngChev,notAnAccount',
      }),
    ).toEqual(['youngChev']);
  });

  it('never lets a client role reach anything it was not granted', () => {
    expect(
      resolveAuditScope({
        allAccountKeys: ROSTER,
        role: 'client',
        sessionAccountKeys: [],
        requestedParam: 'youngChev',
      }),
    ).toEqual([]);
  });

  // An empty param is the all-accounts overview, NOT an empty scope. The client
  // guards against firing before its context settles; this pins the server's
  // half of that contract so the two halves can't drift apart silently.
  it('reads an empty request as everything permitted, not as nothing', () => {
    expect(
      resolveAuditScope({
        allAccountKeys: ROSTER,
        role: 'admin',
        sessionAccountKeys: ['youngHonda'],
        requestedParam: '',
      }),
    ).toEqual(['youngHonda']);
  });

  it('returns the roster order, not the order the caller asked in', () => {
    expect(
      resolveAuditScope({
        allAccountKeys: ROSTER,
        role: 'super_admin',
        sessionAccountKeys: [],
        requestedParam: 'youngKia,youngChev',
      }),
    ).toEqual(['youngChev', 'youngKia']);
  });

  it('deduplicates a repeated key instead of auditing it twice', () => {
    expect(
      resolveAuditScope({
        allAccountKeys: ROSTER,
        role: 'super_admin',
        sessionAccountKeys: [],
        requestedParam: 'youngChev,youngChev',
      }),
    ).toEqual(['youngChev']);
  });
});
