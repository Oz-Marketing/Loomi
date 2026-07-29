import { describe, it, expect } from 'vitest';
import {
  chooseVehicleImage,
  pickStockUnit,
  stockGate,
  stockGatePassed,
  stockUnitPatch,
  unmetByInventory,
  type StockUnit,
} from './inventory-match';

function unit(vin: string, over: Partial<StockUnit> = {}): StockUnit {
  return {
    vin,
    stockNumber: null,
    trim: null,
    price: null,
    msrp: null,
    color: null,
    colorDetail: null,
    imageUrls: [],
    ...over,
  };
}

describe('stockGate', () => {
  it('is not enforced when minStock is 0 — the default', () => {
    // Must stay available: a dealer with no feed would otherwise be gated to zero.
    const r = stockGate(0, 0);
    expect(r.verdict).toBe('not_enforced');
    expect(stockGatePassed(r)).toBe(true);
  });

  it('passes at or above the minimum', () => {
    expect(stockGatePassed(stockGate(5, 5))).toBe(true);
    expect(stockGatePassed(stockGate(9, 5))).toBe(true);
  });

  it('blocks below the minimum and says by how much', () => {
    const r = stockGate(2, 5);
    expect(r.verdict).toBe('below_minimum');
    expect(stockGatePassed(r)).toBe(false);
    expect(r.reason).toContain('Only 2');
  });

  it('distinguishes no stock from merely too little', () => {
    expect(stockGate(0, 5).verdict).toBe('no_stock');
    expect(stockGate(1, 5).verdict).toBe('below_minimum');
  });
});

describe('pickStockUnit', () => {
  it('returns null for an empty lot', () => {
    expect(pickStockUnit([], 'LT')).toBeNull();
  });

  it('prefers an exact trim match over a cheaper mismatched unit', () => {
    const chosen = pickStockUnit(
      [unit('AAA', { trim: 'LS', price: 100 }), unit('BBB', { trim: 'LT', price: 999 })],
      'LT',
    );
    expect(chosen?.vin).toBe('BBB');
  });

  it('accepts a partial trim match ahead of an unrelated trim', () => {
    const chosen = pickStockUnit(
      [unit('AAA', { trim: 'Sport' }), unit('BBB', { trim: 'LT Premium' })],
      'LT',
    );
    expect(chosen?.vin).toBe('BBB');
  });

  it('prefers a unit with photos within the same tier', () => {
    const chosen = pickStockUnit(
      [unit('AAA', { trim: 'LT', price: 100 }), unit('BBB', { trim: 'LT', price: 100, imageUrls: ['http://i/1.jpg'] })],
      'LT',
    );
    expect(chosen?.vin).toBe('BBB');
  });

  it('then prefers the lowest advertised price', () => {
    const chosen = pickStockUnit(
      [unit('AAA', { trim: 'LT', price: 40000 }), unit('BBB', { trim: 'LT', price: 38000 })],
      'LT',
    );
    expect(chosen?.vin).toBe('BBB');
  });

  it('treats a missing price as worst, not best', () => {
    const chosen = pickStockUnit([unit('AAA', { trim: 'LT' }), unit('BBB', { trim: 'LT', price: 40000 })], 'LT');
    expect(chosen?.vin).toBe('BBB');
  });

  it('is deterministic when every ranking key ties', () => {
    // The VIN tiebreak exists so a re-run can't swap the VIN printed on an
    // already-approved draft.
    const units = [unit('ZZZ', { trim: 'LT', price: 100 }), unit('AAA', { trim: 'LT', price: 100 })];
    expect(pickStockUnit(units, 'LT')?.vin).toBe('AAA');
    expect(pickStockUnit([...units].reverse(), 'LT')?.vin).toBe('AAA');
  });

  it('ignores trim ranking when the offer names no trim', () => {
    const chosen = pickStockUnit([unit('AAA', { trim: 'LS', price: 200 }), unit('BBB', { trim: 'LT', price: 100 })]);
    expect(chosen?.vin).toBe('BBB'); // falls through to price
  });
});

describe('stockUnitPatch', () => {
  it('carries the VIN and stock number', () => {
    const p = stockUnitPatch(unit('1GC123', { stockNumber: 'A42' }));
    expect(p.vin).toBe('1GC123');
    expect(p.stockNumber).toBe('A42');
  });

  it('fills MSRP only when the offer supplied none', () => {
    expect(stockUnitPatch(unit('X', { msrp: 41000 }), {}).msrp).toBe('41000');
  });

  it('never overwrites the offer’s own MSRP', () => {
    // The programme's MSRP is what its discount maths was built on — replacing it
    // with this unit's sticker would make the advertised saving wrong.
    const p = stockUnitPatch(unit('X', { msrp: 41000 }), { msrp: '38500' });
    expect(p.msrp).toBeUndefined();
  });

  it('omits a stock number the feed did not provide', () => {
    expect(stockUnitPatch(unit('X')).stockNumber).toBeUndefined();
  });
});

describe('chooseVehicleImage', () => {
  it('prefers EVOX when available', () => {
    const c = chooseVehicleImage('http://evox/car.png', unit('X', { imageUrls: ['http://dealer/1.jpg'] }));
    expect(c.source).toBe('evox');
  });

  it('NEVER falls back to a dealer photo, even when the feed has one', () => {
    // Dealers composite website furniture into their photos. A real Silverado
    // 3500HD feed photo carried "90 DAYS NO PAYMENTS" and "$1000 GAS CARD" burned
    // in, which would have put two competing offers in one creative.
    const c = chooseVehicleImage(null, unit('X', { imageUrls: ['http://dealer/1.jpg'] }));
    expect(c.source).toBe('none');
    expect(c.url).toBeNull();
    expect(c.reason).toContain('not used');
  });

  it('explains that the model needs EVOX coverage, since that is the actual fix', () => {
    const c = chooseVehicleImage(null, unit('X'));
    expect(c.source).toBe('none');
    expect(c.reason).toContain('EVOX');
  });

  it('handles having no stock unit at all', () => {
    expect(chooseVehicleImage(null, null).source).toBe('none');
    expect(chooseVehicleImage('http://evox/car.png', null).source).toBe('evox');
  });
});

describe('unmetByInventory', () => {
  it('flags a required VIN as satisfiable when a unit is on hand', () => {
    const r = unmetByInventory(['vin'], {}, unit('1GC123'));
    expect(r).toEqual([{ field: 'vin', satisfiableFromStock: true }]);
  });

  it('flags it as unsatisfiable when there is no unit', () => {
    // This is the difference between "we can automate this make now" and "we
    // still can't" — worth reporting distinctly rather than as one opaque skip.
    expect(unmetByInventory(['vin'], {}, null)).toEqual([{ field: 'vin', satisfiableFromStock: false }]);
  });

  it('ignores fields the offer already filled', () => {
    expect(unmetByInventory(['vin', 'aprTerm'], { vin: '1GC123', aprTerm: '60' }, null)).toEqual([]);
  });

  it('knows inventory cannot supply an arbitrary field', () => {
    expect(unmetByInventory(['financialInstitution'], {}, unit('X'))).toEqual([
      { field: 'financialInstitution', satisfiableFromStock: false },
    ]);
  });

  it('treats whitespace as unfilled', () => {
    expect(unmetByInventory(['vin'], { vin: '   ' }, unit('1GC123'))[0].satisfiableFromStock).toBe(true);
  });
});
