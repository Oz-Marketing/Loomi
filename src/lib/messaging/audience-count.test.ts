import { describe, expect, it } from 'vitest';
import { AUDIENCE_SAMPLE_MAX, projectAudienceCount, requestedSampleSize } from './audience-count';

const rows = Array.from({ length: 80 }, (_, i) => ({
  contactId: `c${i}`,
  accountKey: 'acct',
  fullName: `Person ${i}`,
  email: `p${i}@example.test`,
  phone: `+1555000${String(i).padStart(4, '0')}`,
}));

describe('requestedSampleSize', () => {
  it('is a count only unless a positive limit is sent', () => {
    expect(requestedSampleSize(undefined)).toBe(0);
    expect(requestedSampleSize(null)).toBe(0);
    expect(requestedSampleSize(0)).toBe(0);
    expect(requestedSampleSize(-5)).toBe(0);
    expect(requestedSampleSize('abc')).toBe(0);
    expect(requestedSampleSize(10)).toBe(10);
    expect(requestedSampleSize('12.9')).toBe(12);
  });

  it('never samples more than the cap', () => {
    expect(requestedSampleSize(5000)).toBe(AUDIENCE_SAMPLE_MAX);
    expect(requestedSampleSize(Infinity)).toBe(0);
  });
});

// The route used to return every matching contact's name, email and phone on
// each audience click — to users without the PII-export permission.
describe('projectAudienceCount', () => {
  it('returns only the total by default', () => {
    expect(projectAudienceCount({ total: 80, recipients: rows }, 0)).toEqual({ total: 80 });
  });

  it('samples ids and names only — never addresses or numbers', () => {
    const out = projectAudienceCount({ total: 80, recipients: rows }, 3);
    expect(out).toEqual({
      total: 80,
      truncated: true,
      sample: [
        { contactId: 'c0', fullName: 'Person 0' },
        { contactId: 'c1', fullName: 'Person 1' },
        { contactId: 'c2', fullName: 'Person 2' },
      ],
    });
    expect(JSON.stringify(out)).not.toMatch(/@example\.test|\+1555/);
  });

  it('is not truncated when the sample holds everyone', () => {
    expect(projectAudienceCount({ total: 2, recipients: rows.slice(0, 2) }, 10)).toMatchObject({
      truncated: false,
    });
  });
});
