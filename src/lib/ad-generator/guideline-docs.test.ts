import { describe, it, expect } from 'vitest';
import { docState, hashBytes, RECENT_UPDATE_DAYS } from './guideline-docs';

const enc = (s: string) => new TextEncoder().encode(s);
const NOW = new Date('2026-07-30T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('docState', () => {
  it('reports unfetched when no copy is on file', () => {
    const r = docState({ contentHash: null, replacedAt: null, checkError: null }, NOW);
    expect(r.state).toBe('unfetched');
  });

  it('reports stored for a document we hold that has never been replaced', () => {
    // The normal, quiet state — no attestation required to reach it.
    const r = docState({ contentHash: 'a', replacedAt: null, checkError: null }, NOW);
    expect(r.state).toBe('stored');
    expect(r.summary).toBe('On file.');
  });

  it('reports updated after a recent replacement, and says how long ago', () => {
    const r = docState({ contentHash: 'b', replacedAt: daysAgo(3), checkError: null }, NOW);
    expect(r.state).toBe('updated');
    expect(r.summary).toContain('3 days ago');
  });

  it('says "today" rather than "0 days ago"', () => {
    const r = docState({ contentHash: 'b', replacedAt: daysAgo(0), checkError: null }, NOW);
    expect(r.summary).toContain('today');
  });

  it('singularises one day', () => {
    expect(docState({ contentHash: 'b', replacedAt: daysAgo(1), checkError: null }, NOW).summary).toContain(
      '1 day ago',
    );
  });

  it('lets the updated flag fade rather than nagging forever', () => {
    // A replacement is history, not a task — past the horizon it goes quiet on its
    // own, which is the whole point of dropping the review gate.
    expect(docState({ contentHash: 'b', replacedAt: daysAgo(RECENT_UPDATE_DAYS), checkError: null }, NOW).state).toBe(
      'updated',
    );
    expect(
      docState({ contentHash: 'b', replacedAt: daysAgo(RECENT_UPDATE_DAYS + 1), checkError: null }, NOW).state,
    ).toBe('stored');
  });

  it('accepts an ISO string for replacedAt, as the API serializes it', () => {
    const r = docState({ contentHash: 'b', replacedAt: daysAgo(2).toISOString(), checkError: null }, NOW);
    expect(r.state).toBe('updated');
  });

  it('reports unreachable even when we still hold a copy', () => {
    // A 404 is not reassurance: the source a citation points at can no longer be
    // opened, which must not read as "on file".
    const r = docState({ contentHash: 'a', replacedAt: null, checkError: 'HTTP 404' }, NOW);
    expect(r.state).toBe('unreachable');
    expect(r.summary).toContain('404');
  });

  it('prefers unreachable over updated', () => {
    const r = docState({ contentHash: 'b', replacedAt: daysAgo(1), checkError: 'timeout' }, NOW);
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
