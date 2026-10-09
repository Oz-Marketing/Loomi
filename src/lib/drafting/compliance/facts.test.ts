import { describe, expect, it } from 'vitest';
import { extractClaims, indexFacts, isExempt, isSupported, makeIsSupported, makesMentioned } from './facts';

const values = (text: string) =>
  extractClaims(text).map((c) => (c.kind === 'date' ? `${c.month}/${c.day}/${c.year ?? '-'}` : `${c.unit ?? ''}${c.value}`));

describe('extractClaims', () => {
  it('reads money, rates, payments, terms and model numbers', () => {
    expect(values('$10,000 off MSRP ($65,515)')).toEqual(['$10000', '$65515']);
    expect(values('1.9% APR for 72 months')).toEqual(['%1.9', '72']);
    expect(values('Lease for $229/mo')).toEqual(['$229']);
    expect(values('0.90% APR on the 2026 Mazda CX-90')).toEqual(['%0.9', '2026', '90']);
    expect(values('Save $10K')).toEqual(['$10000']);
  });

  it('reads dates in every form a request or creative uses', () => {
    expect(values('Ends 10/31/2026')).toEqual(['10/31/2026']);
    expect(values('ends Oct. 31st')).toEqual(['10/31/-']);
    expect(values('through October 31, 2026')).toEqual(['10/31/2026']);
    expect(values('Complete by 2026-11-01')).toEqual(['11/1/2026']);
    // Not a date: no day.
    expect(values('October 2026 offers')).toEqual(['2026']);
  });

  it('exempts a bare single digit, but never a unit', () => {
    const [three] = extractClaims('3 rows');
    const [zero] = extractClaims('0% APR');
    expect(isExempt(three)).toBe(true);
    expect(isExempt(zero)).toBe(false);
  });
});

describe('isSupported', () => {
  const facts = indexFacts(['$3,500 off MSRP, 1.9% APR for 72 months, ends 10/31/2026']);

  it('matches amounts regardless of formatting', () => {
    for (const text of ['$3,500', '$3500', '$3,500.00', '1.9%', '1.90%', '72']) {
      const [claim] = extractClaims(text);
      expect(isSupported(claim, facts), text).toBe(true);
    }
  });

  it('never lets a date part or a different unit vouch for money or a rate', () => {
    // 10 is the month of the expiry date; 72 is a term; 1.9 is a rate.
    for (const text of ['$10', '10%', '$72', '$1.9']) {
      const [claim] = extractClaims(text);
      expect(isSupported(claim, facts), text).toBe(false);
    }
    // …but a bare number may lean on a date: "through the 31st", "2026 models".
    for (const text of ['31', '2026']) {
      const [claim] = extractClaims(text);
      expect(isSupported(claim, facts), text).toBe(true);
    }
  });
});

describe('makes', () => {
  it('finds brands by their capitalized names and trade shorthand', () => {
    expect(makesMentioned('Trade your Chevy for a new Ram 1500 or a VW')).toEqual(
      expect.arrayContaining(['Chevrolet', 'Ram', 'Volkswagen']),
    );
    expect(makesMentioned('New 2026 MAZDA CX-90')).toEqual(['Mazda']);
    expect(makesMentioned('ram through winter, ford a river, a mini break')).toEqual([]);
  });

  it('lets a Honda Powersports store say "Honda"', () => {
    expect(makeIsSupported('Honda', ['Honda Powersports'], [])).toBe(true);
    expect(makeIsSupported('Jeep', ['Mazda'], [])).toBe(false);
    expect(makeIsSupported('Jeep', ['Mazda'], ['Conquest: current Jeep owners'])).toBe(true);
  });
});
