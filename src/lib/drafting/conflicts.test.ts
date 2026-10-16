import { describe, expect, it } from 'vitest';
import { findConflicts } from './conflicts';
import type { CreativeReading } from './reading';

function reading(fields: Record<string, string>, disclaimer: string | null = null): CreativeReading {
  return {
    requestType: 'model_offer',
    fields: Object.entries(fields).map(([key, value]) => ({ key, label: key, value, confidence: 'high' })),
    disclaimer: disclaimer ? { text: disclaimer, confidence: 'high' } : null,
    model: 'm',
    readAt: 'now',
  };
}

const CX90 = reading({ apr: '1.9% APR', term: '72 months', expiration: 'Offer ends 10/31/2026' });

describe('findConflicts', () => {
  it('passes when the request states the same terms', () => {
    const r = findConflicts(CX90, { details: '2026 CX-90: 1.9% APR for 72 months. Offer ends Oct 31.', offerDisclaimer: '' });
    expect(r.conflicts).toEqual([]);
  });

  it('stops on a rate the request states differently, reporting both values', () => {
    const r = findConflicts(CX90, { details: 'CX-90 at 2.9% APR for 72 months', offerDisclaimer: '' });
    expect(r.conflicts).toEqual([{ field: 'apr', label: 'APR', creative: '1.9% APR', request: '2.9%' }]);
  });

  it('stops on a different expiry, however each side writes the date', () => {
    const r = findConflicts(CX90, { details: 'Offer valid through 11/30/2026', offerDisclaimer: '' });
    expect(r.conflicts.map((c) => c.field)).toEqual(['expiration']);
    expect(findConflicts(CX90, { details: 'Expires October 31, 2026', offerDisclaimer: '' }).conflicts).toEqual([]);
  });

  it('compares only what both sides state', () => {
    // The request says nothing about the term or the expiry.
    expect(findConflicts(CX90, { details: '1.9% APR on the CX-90', offerDisclaimer: '' }).conflicts).toEqual([]);
    expect(findConflicts(CX90, { details: '', offerDisclaimer: '' }).conflicts).toEqual([]);
  });

  it('does not take a model year or a mileage for a term', () => {
    const r = findConflicts(CX90, { details: '2026 models, 72 months, 10,000 miles per year', offerDisclaimer: '' });
    expect(r.conflicts).toEqual([]);
  });

  it('accepts a request that lists several values for a term when one is the creative\'s', () => {
    const lease = reading({ payment: '$299/mo' });
    const r = findConflicts(lease, { details: 'Lease $299/mo or finance $449/mo', offerDisclaimer: '' });
    expect(r.conflicts).toEqual([]);
  });

  it('stops on a disclaimer whose figures differ', () => {
    const r = findConflicts(reading({}, 'MSRP $36,995. Take delivery by 10/31/2026.'), {
      details: '',
      offerDisclaimer: 'MSRP $37,995. Take delivery by 10/31/2026.',
    });
    expect(r.conflicts.map((c) => c.field)).toEqual(['disclaimer']);
  });

  it('only notes a disclaimer worded differently with the same figures', () => {
    const r = findConflicts(reading({}, 'MSRP $36,995. Take delivery by 10/31/2026. See dealer.'), {
      details: '',
      offerDisclaimer: 'MSRP of $36,995; must take delivery by 10/31/2026.',
    });
    expect(r.conflicts).toEqual([]);
    expect(r.notes).toHaveLength(1);
  });
});
