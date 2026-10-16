import { describe, expect, it } from 'vitest';
import { factSources, fieldValue, toReading, type ReadReply } from './extraction';

const META = { model: 'claude-opus-5-5', readAt: '2026-10-14T00:00:00.000Z', assetIds: ['a1'] };

function reply(patch: Partial<ReadReply> = {}): ReadReply {
  return {
    requestType: 'model_offer',
    offerType: 'finance',
    vehicle: { year: '2026', make: 'Mazda', model: 'CX-90', trim: null },
    fields: [
      { key: 'term', value: '72 months', confidence: 'high', image: 1 },
      { key: 'headline', value: '  The new  2026 CX-90 ', confidence: 'high', image: 1 },
      { key: 'apr', value: '1.9% APR', confidence: 'high', image: 1 },
    ],
    disclaimer: { text: 'Offer ends 10/31/2026.\n  See dealer   for details.', confidence: 'high' },
    unreadable: [],
    ...patch,
  };
}

describe('toReading', () => {
  it('keeps fields in the update order, labeled, whitespace tidied', () => {
    const r = toReading(reply(), META);
    expect(r.fields.map((f) => f.key)).toEqual(['headline', 'term', 'apr']);
    expect(r.fields[0]).toMatchObject({ label: 'Headline', value: 'The new 2026 CX-90', assetId: 'a1' });
    expect(r.vehicle).toEqual({ year: 2026, make: 'Mazda', model: 'CX-90', trim: null });
  });

  it('drops invented keys and empty values rather than passing them on', () => {
    const r = toReading(
      reply({ fields: [{ key: 'monthlyPayment', value: '$299', confidence: 'high', image: 1 }, { key: 'cta', value: ' ', confidence: 'high', image: 1 }] }),
      META,
    );
    expect(r.fields).toEqual([]);
  });

  it('keeps the disclaimer verbatim within a line, and its paragraph breaks', () => {
    expect(toReading(reply(), META).disclaimer?.text).toBe('Offer ends 10/31/2026.\nSee dealer for details.');
  });

  it('treats anything but an explicit "high" as low confidence', () => {
    const r = toReading(reply({ disclaimer: { text: 'x', confidence: 'medium' } }), META);
    expect(r.disclaimer?.confidence).toBe('low');
  });

  it('turns an unknown request type into other, which is not drafted', () => {
    expect(toReading(reply({ requestType: 'flyer' }), META).requestType).toBe('other');
  });

  it('pins a field to the asset it came from when the creative is several files', () => {
    const r = toReading(reply({ fields: [{ key: 'apr', value: '1.9% APR', confidence: 'high', image: 2 }] }), {
      ...META,
      assetIds: ['a1', 'a2'],
    });
    expect(r.fields[0].assetId).toBe('a2');
  });
});

describe('factSources', () => {
  it('is every reading, the disclaimer and the written request — nothing else', () => {
    const r = toReading(reply(), META);
    const facts = factSources(r, { name: 'CX-90 Monthly Offer', details: '1.9% for 72', offerDisclaimer: '' });
    expect(facts.map((f) => f.label)).toEqual([
      'extraction.headline',
      'extraction.term',
      'extraction.apr',
      'extraction.vehicle',
      'extraction.disclaimer',
      'request.name',
      'request.details',
    ]);
    expect(fieldValue(r, 'apr')).toBe('1.9% APR');
  });
});
