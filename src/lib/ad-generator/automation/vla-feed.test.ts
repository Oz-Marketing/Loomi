import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_VLA_MAPPING,
  enrichColor,
  groupNewStock,
  newVehicles,
  parseAmount,
  parseCondition,
  parseMileage,
  parseVlaFeed,
} from './vla-feed';

/** Real slices of the four Young VLA feeds, captured 2026-07-28. */
function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '__fixtures__', `${name}.csv`), 'utf8');
}

describe('parseAmount', () => {
  it('strips the embedded currency unit', () => {
    expect(parseAmount('31807 USD')).toBe(31807);
    expect(parseAmount('42552 USD')).toBe(42552);
  });

  it('handles separators and bare numbers', () => {
    expect(parseAmount('1,234 USD')).toBe(1234);
    expect(parseAmount('999')).toBe(999);
  });

  it('is null for empty or non-numeric input', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount('Call for price')).toBeNull();
  });
});

describe('parseMileage', () => {
  it('strips the Miles unit', () => {
    expect(parseMileage('56299 Miles')).toBe(56299);
    expect(parseMileage('15 Miles')).toBe(15); // delivery mileage on a new unit
  });
});

describe('parseCondition', () => {
  it('maps New and Used', () => {
    expect(parseCondition('New', 'false')).toBe('new');
    expect(parseCondition('Used', 'false')).toBe('used');
  });

  it('promotes a CPO used unit to certified', () => {
    expect(parseCondition('Used', 'true')).toBe('certified');
  });

  it('never lets the CPO flag override New', () => {
    expect(parseCondition('New', 'true')).toBe('new');
  });

  it('defaults unknown values to used, so a mislabelled car never gets a new-vehicle offer', () => {
    expect(parseCondition('', '')).toBe('used');
    expect(parseCondition('Demo', '')).toBe('used');
  });
});

describe('enrichColor', () => {
  it('recovers the fuller OEM colour once the title is stripped', () => {
    expect(
      enrichColor(
        'Gray Metallic',
        '2026 Mazda CX-5 2.5 S Premium Plus Polymetal Gray Metallic AWD 6-Speed',
        '2026 Mazda CX-5 2.5 S Premium Plus',
      ),
    ).toBe('Polymetal Gray Metallic');
  });

  it('picks up a trailing qualifier', () => {
    expect(
      enrichColor(
        'Jet Black',
        '2026 Mazda CX-5 2.5 S Preferred Jet Black Mica AWD 6-Speed',
        '2026 Mazda CX-5 2.5 S Preferred',
      ),
    ).toBe('Jet Black Mica');
  });

  it('does not swallow trim words, which are capitalized too', () => {
    // Without the title strip this returned "S Preferred Jet Black Mica".
    const out = enrichColor(
      'Jet Black',
      '2026 Mazda CX-5 2.5 S Preferred Jet Black Mica AWD',
      '2026 Mazda CX-5 2.5 S Preferred',
    );
    expect(out).not.toContain('Preferred');
  });

  it('falls back when the description is boilerplate', () => {
    // Young Chevrolet's descriptions carry no colour at all.
    expect(
      enrichColor(
        'Summit White',
        'Thank you for working with Young Chevrolet. Everyone is Eligible',
        '2026 Chevrolet Trax LT',
      ),
    ).toBe('Summit White');
  });

  it('falls back when the colour is not at the front of the remainder', () => {
    // Refusing a mid-string match is what keeps trim words out.
    expect(enrichColor('Red', 'Loaded with options. Red exterior.', 'Title')).toBe('Red');
  });

  it('still works with no title supplied', () => {
    expect(enrichColor('Gray Metallic', 'Polymetal Gray Metallic AWD 6-Speed')).toBe(
      'Polymetal Gray Metallic',
    );
  });

  it('never returns something shorter than the input', () => {
    expect(enrichColor('Red', 'Red')).toBe('Red');
  });

  it('handles empty inputs', () => {
    expect(enrichColor('', 'anything')).toBe('');
    expect(enrichColor('Blue', '')).toBe('Blue');
  });

  it('does not blow up on regex metacharacters in a colour name', () => {
    expect(() => enrichColor('Red (Special)', 'Red (Special) car', '')).not.toThrow();
  });
});

describe('parseVlaFeed — real Young Mazda Ogden feed', () => {
  const feed = parseVlaFeed(fixture('young-mazda-ogden'));

  it('parses every row without issues', () => {
    expect(feed.issues).toEqual([]);
    expect(feed.vehicles).toHaveLength(feed.totalRows);
  });

  it('finds no missing mapped columns', () => {
    expect(feed.missingColumns).toEqual([]);
  });

  it('normalizes a new unit end to end', () => {
    const v = newVehicles(feed)[0];
    expect(v.vin).toMatch(/^[A-Z0-9]{17}$/);
    expect(v.condition).toBe('new');
    expect(v.make).toBe('Mazda');
    expect(v.year).toBeGreaterThanOrEqual(2026);
    expect(v.msrp).toBeGreaterThan(10000);
    expect(v.price).toBeGreaterThan(10000);
    expect(v.stockNumber).toBeTruthy();
    expect(v.trim).toBeTruthy();
  });

  it('carries real dealer photos on every new unit', () => {
    // 100% photo coverage is what lets automation skip EVOX for stock ads.
    for (const v of newVehicles(feed)) {
      expect(v.imageUrls.length).toBeGreaterThan(0);
      expect(v.imageUrls[0]).toMatch(/^https?:\/\//);
    }
  });

  it('enriches at least one colour beyond the plain feed value', () => {
    const enriched = newVehicles(feed).filter((v) => v.colorDetail !== v.color);
    expect(enriched.length).toBeGreaterThan(0);
  });

  it('has MSRP on every new unit and none on used', () => {
    expect(newVehicles(feed).every((v) => v.msrp !== null)).toBe(true);
    const used = feed.vehicles.filter((v) => v.condition !== 'new');
    expect(used.every((v) => v.msrp === null)).toBe(true);
  });
});

describe('parseVlaFeed — real Young Chev feed', () => {
  const feed = parseVlaFeed(fixture('young-chev'));

  it('parses cleanly', () => {
    expect(feed.issues).toEqual([]);
    expect(feed.missingColumns).toEqual([]);
  });

  it('reads new Chevrolet stock with MSRP', () => {
    const nw = newVehicles(feed);
    expect(nw.length).toBeGreaterThan(0);
    expect(nw.every((v) => v.make === 'Chevrolet')).toBe(true);
    expect(nw.every((v) => v.msrp !== null)).toBe(true);
  });

  it('leaves colours unenriched where descriptions are boilerplate', () => {
    expect(newVehicles(feed).every((v) => v.colorDetail === v.color)).toBe(true);
  });
});

describe('parseVlaFeed — the used-only feed', () => {
  const feed = parseVlaFeed(fixture('young-used'));

  it('contains no new stock, so yields nothing for incentive ads', () => {
    expect(feed.vehicles.length).toBeGreaterThan(0);
    expect(newVehicles(feed)).toEqual([]);
    expect(groupNewStock(feed)).toEqual([]);
  });
});

describe('parseVlaFeed — mixed-brand used rows', () => {
  it('keeps used rows from other brands but excludes them from new stock', () => {
    const feed = parseVlaFeed(fixture('young-mazda-ogden'));
    const makes = new Set(feed.vehicles.map((v) => v.make));
    // The Mazda store's USED rows are mixed-brand...
    expect(makes.size).toBeGreaterThan(1);
    // ...while its NEW rows are single-brand, which is what OEM offers need.
    expect(new Set(newVehicles(feed).map((v) => v.make)).size).toBe(1);
  });
});

describe('groupNewStock', () => {
  it('groups by year/make/model with counts', () => {
    const groups = groupNewStock(parseVlaFeed(fixture('young-chev')));
    expect(groups.length).toBeGreaterThan(0);
    const total = groups.reduce((n, g) => n + g.count, 0);
    expect(total).toBe(newVehicles(parseVlaFeed(fixture('young-chev'))).length);
    for (const g of groups) expect(g.vehicles).toHaveLength(g.count);
  });

  it('is deterministic', () => {
    const a = groupNewStock(parseVlaFeed(fixture('young-mazda-idaho'))).map((g) => `${g.year} ${g.model}`);
    const b = groupNewStock(parseVlaFeed(fixture('young-mazda-idaho'))).map((g) => `${g.year} ${g.model}`);
    expect(a).toEqual(b);
  });
});

describe('parseVlaFeed — malformed input', () => {
  const header = 'VIN,id,year,brand,model,trim,condition,certified_pre_owned,price,vehicle_msrp,color,mileage,title,description,link,store_code,body_style,image_link';

  it('collects bad rows as issues without losing the good ones', () => {
    const csv = [
      header,
      ',STK1,2026,Mazda,CX-5,S,New,false,100 USD,200 USD,Red,5 Miles,t,d,http://x,MP1,SUV,http://i',
      '1HGCM82633A004352,STK2,notayear,Mazda,CX-5,S,New,false,100 USD,200 USD,Red,5 Miles,t,d,http://x,MP1,SUV,http://i',
      '1HGCM82633A004353,STK3,2026,,,S,New,false,100 USD,200 USD,Red,5 Miles,t,d,http://x,MP1,SUV,http://i',
      '1HGCM82633A004354,STK4,2026,Mazda,CX-5,S,New,false,100 USD,200 USD,Red,5 Miles,t,d,http://x,MP1,SUV,http://i',
    ].join('\n');
    const feed = parseVlaFeed(csv);
    expect(feed.vehicles).toHaveLength(1);
    expect(feed.vehicles[0].stockNumber).toBe('STK4');
    expect(feed.issues.map((i) => i.reason)).toEqual([
      'missing VIN',
      expect.stringContaining('unusable year'),
      expect.stringContaining('missing make/model'),
    ]);
  });

  it('rejects a duplicate VIN as a provider bug, not two cars', () => {
    const row = '1HGCM82633A004354,STK4,2026,Mazda,CX-5,S,New,false,100 USD,200 USD,Red,5 Miles,t,d,http://x,MP1,SUV,http://i';
    const feed = parseVlaFeed([header, row, row].join('\n'));
    expect(feed.vehicles).toHaveLength(1);
    expect(feed.issues[0].reason).toContain('duplicate VIN');
  });

  it('reports missing mapped columns — the earliest signal of a schema change', () => {
    const feed = parseVlaFeed('VIN,year\n1HGCM82633A004354,2026');
    expect(feed.missingColumns).toContain('brand');
    expect(feed.missingColumns).toContain('condition');
    expect(feed.vehicles).toEqual([]);
  });

  it('handles an empty body without throwing', () => {
    const feed = parseVlaFeed('');
    expect(feed.vehicles).toEqual([]);
    expect(feed.totalRows).toBe(0);
  });
});

describe('custom field mapping', () => {
  it('supports a provider that names its columns differently', () => {
    const csv = 'vehicle_id,stock,yr,mk,mdl,state\nJH4KA7561PC008269,A1,2026,Honda,Civic,New';
    const feed = parseVlaFeed(csv, {
      ...DEFAULT_VLA_MAPPING,
      vin: 'vehicle_id',
      stockNumber: 'stock',
      year: 'yr',
      make: 'mk',
      model: 'mdl',
      condition: 'state',
      images: [],
    });
    expect(feed.vehicles).toHaveLength(1);
    expect(feed.vehicles[0].make).toBe('Honda');
    expect(feed.vehicles[0].condition).toBe('new');
  });
});
