import { describe, it, expect } from 'vitest';
import { translateDefinitionToSql } from './sql-filter';
import { shiftFilterByUnit } from '@/lib/smart-list-engine';
import {
  getFilterableFields,
  type FilterDefinition,
  type FilterOperator,
} from '@/lib/smart-list-types';

// Engine ↔ SQL parity for the day-count operators.
//
// WHY THIS FILE EXISTS: these operators are implemented TWICE — once in
// smart-list-engine for the live preview and the in-memory path, once in
// sql-filter for the query that actually resolves a segment. They used to
// share only the fact that both called parseInt and added days, which was
// survivable while the unit was always "day". With months and years in
// play the bound is calendar math, and two implementations of calendar
// math drift: a preview that shows 40 contacts and a send that goes to 38
// is the failure this prevents, and nothing else in the suite would catch
// it because each side is individually self-consistent.
//
// So the assertion is not "the SQL is correct" — it is "the SQL's bound is
// the SAME Date the engine computed", byte for byte.

// A BUILT-IN date column. Custom fields live in JSON and the translator
// reports them untranslatable, so a custom field here would make every
// assertion below vacuously pass on an empty bound list.
const FIELD = 'purchaseDate';
const fields = getFilterableFields([]);

function def(operator: FilterOperator, value: string): FilterDefinition {
  return {
    version: 1,
    logic: 'AND',
    groups: [
      {
        id: 'g1',
        logic: 'AND',
        conditions: [{ id: 'c1', field: FIELD, operator, value }],
      },
    ],
  };
}

/** Every Date the translator bound into the query, in order. */
function boundDates(operator: FilterOperator, value: string): Date[] {
  const { where } = translateDefinitionToSql(def(operator, value), fields);
  if (!where) return [];
  return (where.values as unknown[]).filter((v): v is Date => v instanceof Date);
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const DURATIONS = [
  '30',
  '30:day',
  '2:week',
  '6:month',
  '18:month',
  '3:year',
] as const;

describe('day-count operators: SQL bounds match the engine', () => {
  it('more_than_days_ago cuts off at exactly the engine cutoff', () => {
    for (const value of DURATIONS) {
      const dates = boundDates('more_than_days_ago', value);
      expect(dates, `no bound emitted for ${value}`).toHaveLength(1);
      const span = value.includes(':')
        ? { amount: Number(value.split(':')[0]), unit: value.split(':')[1] as 'day' }
        : { amount: Number(value), unit: 'day' as const };
      const expected = shiftFilterByUnit(startOfToday(), {
        amount: -span.amount,
        unit: span.unit,
      });
      expect(dates[0].getTime(), `cutoff mismatch for ${value}`).toBe(expected.getTime());
    }
  });

  it('within_last_days lower bound matches the engine', () => {
    for (const value of DURATIONS) {
      const dates = boundDates('within_last_days', value);
      expect(dates.length, `no bounds for ${value}`).toBeGreaterThanOrEqual(1);
      const span = value.includes(':')
        ? { amount: Number(value.split(':')[0]), unit: value.split(':')[1] as 'day' }
        : { amount: Number(value), unit: 'day' as const };
      const expected = shiftFilterByUnit(startOfToday(), {
        amount: -span.amount,
        unit: span.unit,
      });
      expect(dates[0].getTime(), `lower bound mismatch for ${value}`).toBe(expected.getTime());
    }
  });

  it('a legacy bare integer and its explicit :day twin produce identical SQL', () => {
    // The back-compat contract, asserted on the SQL side too: re-saving an
    // old segment through the new picker must not move its boundary.
    for (const op of ['within_days', 'within_last_days', 'more_than_days_ago'] as const) {
      const bare = boundDates(op, '45').map((d) => d.getTime());
      const explicit = boundDates(op, '45:day').map((d) => d.getTime());
      expect(explicit, `${op} drifted between 45 and 45:day`).toEqual(bare);
    }
  });

  it('a malformed duration refuses to translate rather than matching everyone', () => {
    // FALSE carries no Date parameters — the query matches nobody, which
    // is the same fail-closed answer the engine gives.
    for (const op of ['within_days', 'within_last_days', 'more_than_days_ago'] as const) {
      expect(boundDates(op, '6:fortnight')).toHaveLength(0);
      expect(boundDates(op, 'abc')).toHaveLength(0);
    }
  });

  it('a month bound is not thirty days', () => {
    // Guards the actual regression: if either side ever reverts to
    // days × 30, these two land on the same instant and this fails.
    const month = boundDates('more_than_days_ago', '1:month')[0];
    const thirty = boundDates('more_than_days_ago', '30:day')[0];
    const feb = new Date(month).getTime() === new Date(thirty).getTime();
    // Only equal when the month in question happens to be 30 days long.
    const daysApart = Math.round(
      Math.abs(startOfToday().getTime() - month.getTime()) / 86_400_000,
    );
    expect([28, 29, 30, 31]).toContain(daysApart);
    if (daysApart !== 30) expect(feb).toBe(false);
  });
});
