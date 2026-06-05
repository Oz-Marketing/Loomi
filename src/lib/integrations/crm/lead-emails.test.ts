import { describe, it, expect } from 'vitest';
import {
  parseLeadEmails,
  normalizeLeadEmails,
  stringifyLeadEmails,
  isValidEmail,
} from './lead-emails';

describe('parseLeadEmails', () => {
  it('parses a JSON array', () => {
    expect(parseLeadEmails('["a@x.com","b@y.com"]')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('round-trips with stringifyLeadEmails', () => {
    const list = ['leads@tekion.example.com', 'sales@store.example.com'];
    expect(parseLeadEmails(stringifyLeadEmails(list))).toEqual(list);
  });

  it('tolerates a legacy single address', () => {
    expect(parseLeadEmails('leads@crm.example.com')).toEqual(['leads@crm.example.com']);
  });

  it('tolerates comma / semicolon / newline separated strings', () => {
    expect(parseLeadEmails('a@x.com, b@y.com; c@z.com')).toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
    expect(parseLeadEmails('a@x.com\nb@y.com')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('returns [] for empty / null / malformed', () => {
    expect(parseLeadEmails(null)).toEqual([]);
    expect(parseLeadEmails('')).toEqual([]);
    expect(parseLeadEmails('   ')).toEqual([]);
    expect(parseLeadEmails('[]')).toEqual([]);
  });

  it('drops blank entries inside a JSON array', () => {
    expect(parseLeadEmails('["a@x.com","","  "]')).toEqual(['a@x.com']);
  });
});

describe('normalizeLeadEmails', () => {
  it('validates, trims, and dedupes case-insensitively', () => {
    const { emails, invalid } = normalizeLeadEmails([' A@X.com ', 'a@x.com', 'b@y.com']);
    expect(emails).toEqual(['A@X.com', 'b@y.com']); // first spelling wins, dupe dropped
    expect(invalid).toEqual([]);
  });

  it('surfaces invalid addresses separately', () => {
    const { emails, invalid } = normalizeLeadEmails(['ok@x.com', 'not-an-email', 'also bad@']);
    expect(emails).toEqual(['ok@x.com']);
    expect(invalid).toEqual(['not-an-email', 'also bad@']);
  });

  it('accepts a delimited string as well as an array', () => {
    expect(normalizeLeadEmails('a@x.com, b@y.com').emails).toEqual(['a@x.com', 'b@y.com']);
  });

  it('ignores non-string entries and empties', () => {
    const { emails, invalid } = normalizeLeadEmails(['a@x.com', '', 42, null]);
    expect(emails).toEqual(['a@x.com']);
    expect(invalid).toEqual([]);
  });

  it('empty input → no emails, no invalid', () => {
    expect(normalizeLeadEmails(undefined)).toEqual({ emails: [], invalid: [] });
  });
});

describe('isValidEmail', () => {
  it('accepts normal addresses, rejects malformed', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
    expect(isValidEmail('@c.com')).toBe(false);
  });
});
