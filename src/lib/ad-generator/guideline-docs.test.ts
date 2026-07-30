import { describe, it, expect } from 'vitest';
import { docState, hashBytes } from './guideline-docs';

const enc = (s: string) => new TextEncoder().encode(s);

describe('docState', () => {
  it('reports unfetched before any baseline exists', () => {
    const r = docState({ contentHash: null, reviewedHash: null, checkError: null });
    expect(r.state).toBe('unfetched');
  });

  it('reports unreviewed once fetched but never signed off', () => {
    const r = docState({ contentHash: 'a', reviewedHash: null, checkError: null });
    expect(r.state).toBe('unreviewed');
    expect(r.summary).toContain('mark it reviewed');
  });

  it('reports current when the bytes match the reviewed baseline', () => {
    expect(docState({ contentHash: 'a', reviewedHash: 'a', checkError: null }).state).toBe('current');
  });

  it('reports changed when the document moved after review', () => {
    // The case the whole register exists for.
    const r = docState({ contentHash: 'b', reviewedHash: 'a', checkError: null });
    expect(r.state).toBe('changed');
    expect(r.summary).toContain('CHANGED');
  });

  it('reports unreachable even when the hashes still agree', () => {
    // A 404 is not reassurance: the source a citation points at can no longer be
    // opened, which must not read as "current".
    const r = docState({ contentHash: 'a', reviewedHash: 'a', checkError: 'HTTP 404' });
    expect(r.state).toBe('unreachable');
    expect(r.summary).toContain('404');
  });

  it('prefers unreachable over changed', () => {
    const r = docState({ contentHash: 'b', reviewedHash: 'a', checkError: 'timeout' });
    expect(r.state).toBe('unreachable');
  });
});

describe('hashBytes', () => {
  it('is stable for identical bytes and differs for a one-byte change', () => {
    expect(hashBytes(enc('the guidelines'))).toBe(hashBytes(enc('the guidelines')));
    expect(hashBytes(enc('the guidelines'))).not.toBe(hashBytes(enc('the guideline')));
  });

  it('produces a hex sha256', () => {
    expect(hashBytes(enc('x'))).toMatch(/^[0-9a-f]{64}$/);
  });
});
