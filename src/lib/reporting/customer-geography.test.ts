import { describe, it, expect } from 'vitest';
import {
  foldZipRows,
  foldPlacement,
  attachCentroids,
  type ZipGroupRow,
} from './customer-geography';
import { lookupCentroid, centroidCount } from './zip-centroids';

const row = (o: Partial<ZipGroupRow>): ZipGroupRow => ({
  postal_code: '84010',
  city: 'Bountiful',
  state: 'UT',
  sale_type: '',
  deal_type: '',
  count: 0,
  revenue: 0,
  customer_pay: 0,
  warranty_pay: 0,
  ...o,
});

describe('foldZipRows — deal-type filtering', () => {
  const salesRows = [
    row({ postal_code: '84010', deal_type: 'NEW', count: 10, revenue: 400_000 }),
    row({ postal_code: '84010', deal_type: 'USED', count: 4, revenue: 100_000 }),
    row({ postal_code: '84010', sale_type: 'LEASE', deal_type: 'NEW', count: 2, revenue: 60_000 }),
    row({ postal_code: '84041', city: 'Layton', deal_type: 'NEW', count: 6, revenue: 240_000 }),
  ];

  it('collapses every deal type into one row per ZIP when unfiltered', () => {
    const { zips, totals } = foldZipRows(salesRows, 'sales', 'ALL');
    expect(zips).toHaveLength(2);
    expect(zips[0].postalCode).toBe('84010');
    expect(zips[0].count).toBe(16);
    expect(totals.count).toBe(22);
    expect(totals.zipCount).toBe(2);
  });

  it('keeps only the requested deal type', () => {
    const { zips, totals } = foldZipRows(salesRows, 'sales', 'USED');
    expect(zips).toHaveLength(1);
    expect(zips[0].count).toBe(4);
    expect(totals.count).toBe(4);
  });

  it('treats lease as its own bucket, not as new', () => {
    // The lease row has deal_type NEW; filtering to NEW must exclude it.
    const { totals: newOnly } = foldZipRows(salesRows, 'sales', 'NEW');
    expect(newOnly.count).toBe(16); // 10 + 6, not 18

    const { totals: leaseOnly } = foldZipRows(salesRows, 'sales', 'LEASE');
    expect(leaseOnly.count).toBe(2);
  });

  it('ignores the deal-type filter on the service side', () => {
    // A repair order has no deal type. Applying the filter would empty the map
    // rather than showing every RO.
    const serviceRows = [row({ count: 30, revenue: 12_000, customer_pay: 9_000 })];
    const { totals } = foldZipRows(serviceRows, 'service', 'LEASE');
    expect(totals.count).toBe(30);
  });
});

describe('foldZipRows — shaping', () => {
  it('sorts by volume, densest ZIP first', () => {
    const { zips } = foldZipRows(
      [
        row({ postal_code: '84041', count: 3 }),
        row({ postal_code: '84010', count: 12 }),
        row({ postal_code: '84087', count: 7 }),
      ],
      'sales',
      'ALL',
    );
    expect(zips.map((z) => z.postalCode)).toEqual(['84010', '84087', '84041']);
  });

  it('breaks a volume tie deterministically so the table does not reshuffle', () => {
    const { zips } = foldZipRows(
      [row({ postal_code: '84087', count: 5 }), row({ postal_code: '84010', count: 5 })],
      'sales',
      'ALL',
    );
    expect(zips.map((z) => z.postalCode)).toEqual(['84010', '84087']);
  });

  it('computes each ZIP share of the filtered total, not the raw total', () => {
    // Shares must sum over what is actually displayed, or the map legend lies.
    const { zips } = foldZipRows(
      [
        row({ postal_code: '84010', deal_type: 'NEW', count: 30 }),
        row({ postal_code: '84041', deal_type: 'NEW', count: 10 }),
        row({ postal_code: '84087', deal_type: 'USED', count: 60 }),
      ],
      'sales',
      'NEW',
    );
    expect(zips.map((z) => z.share)).toEqual([0.75, 0.25]);
  });

  it('carries the service pay split through to totals', () => {
    const { totals } = foldZipRows(
      [
        row({ postal_code: '84010', count: 10, revenue: 5_000, customer_pay: 3_000, warranty_pay: 2_000 }),
        row({ postal_code: '84041', count: 5, revenue: 2_500, customer_pay: 2_000, warranty_pay: 500 }),
      ],
      'service',
      'ALL',
    );
    expect(totals.customerPay).toBe(5_000);
    expect(totals.warrantyPay).toBe(2_500);
    expect(totals.avgValue).toBe(500);
  });

  it('returns empty totals without dividing by zero', () => {
    const { zips, totals } = foldZipRows([], 'sales', 'ALL');
    expect(zips).toEqual([]);
    expect(totals.count).toBe(0);
    expect(totals.avgValue).toBe(0);
  });
});

describe('zip centroids', () => {
  it('covers the whole US ZIP space', () => {
    // Guards against a truncated or half-written regeneration.
    expect(centroidCount()).toBeGreaterThan(30_000);
  });

  it('places known ZIPs where they actually are', () => {
    const [lat, lng] = lookupCentroid('84041')!; // Layton, UT
    expect(lat).toBeCloseTo(41.07, 1);
    expect(lng).toBeCloseTo(-111.98, 1);

    const [nyLat, nyLng] = lookupCentroid('10001')!; // Manhattan
    expect(nyLat).toBeCloseTo(40.75, 1);
    expect(nyLng).toBeCloseTo(-73.99, 1);
  });

  it('returns null for a postal code outside the Gazetteer', () => {
    expect(lookupCentroid('T2X1V4')).toBeNull(); // Canadian
    expect(lookupCentroid('00000')).toBeNull();
  });
});

describe('attachCentroids', () => {
  const zip = (postalCode: string, count: number) => ({
    postalCode,
    city: null,
    state: null,
    count,
    revenue: 0,
    customerPay: 0,
    warrantyPay: 0,
    share: 0,
    lat: null as number | null,
    lng: null as number | null,
  });

  it('fills coordinates in place for ZIPs it knows', () => {
    const rows = [zip('84041', 10)];
    attachCentroids(rows);
    expect(rows[0].lat).toBeCloseTo(41.07, 1);
    expect(rows[0].lng).toBeCloseTo(-111.98, 1);
  });

  it('counts what it could not place instead of dropping it', () => {
    // Unplaceable rows still belong in the tables and totals — they are real
    // business, they just can't be drawn.
    const rows = [zip('84041', 10), zip('T2X1V4', 3), zip('00000', 2)];
    const mapping = attachCentroids(rows);

    expect(mapping.unmappedZips).toBe(2);
    expect(mapping.unmappedCount).toBe(5);
    expect(rows).toHaveLength(3);
    expect(rows[1].lat).toBeNull();
  });

  it('reports nothing unmapped when every ZIP resolves', () => {
    const mapping = attachCentroids([zip('84041', 1), zip('10001', 1)]);
    expect(mapping).toEqual({ unmappedZips: 0, unmappedCount: 0 });
  });
});

describe('foldPlacement', () => {
  it('separates the two ways an event falls off the map', () => {
    const p = foldPlacement({ events: 100, placed: 70, unlinked: 20, no_postal: 10 });
    expect(p.unlinked).toBe(20);
    expect(p.noPostal).toBe(10);
    expect(p.overall).toBe(0.7);
    // The three buckets must account for every event, or the banner misleads.
    expect(p.placed + p.unlinked + p.noPostal).toBe(p.events);
  });

  it('reports full coverage when everything places', () => {
    const p = foldPlacement({ events: 40, placed: 40, unlinked: 0, no_postal: 0 });
    expect(p.overall).toBe(1);
  });

  it('handles an empty range', () => {
    expect(foldPlacement(undefined).overall).toBe(0);
  });
});
