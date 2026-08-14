import { describe, it, expect } from 'vitest';
import { addFilterDays, evaluateFilter } from './smart-list-engine';
import { getFilterableFields, type FilterDefinition } from './smart-list-types';
import type { Contact } from '@/lib/contacts/types';

// Merged field set incl. the automotive custom fields (isCustom routes
// reads through Contact.customFields).
const fields = getFilterableFields([
  { key: 'deal_type', label: 'Deal Type', type: 'select', category: 'custom', options: [{ value: 'Purchase', label: 'Purchase' }, { value: 'Lease', label: 'Lease' }] },
  { key: 'last_purchase_date', label: 'Last Purchase Date', type: 'date', category: 'custom' },
  { key: 'last_service_date', label: 'Last Service Date', type: 'date', category: 'custom' },
  { key: 'trade_in_inquiry', label: 'Trade-In Inquiry', type: 'boolean', category: 'custom' },
  { key: 'unit_age_at_purchase', label: 'Unit Age At Purchase', type: 'number', category: 'custom' },
]);

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const contact = {
  id: 'c1',
  tags: ['loomi-yag-purchased'],
  customFields: {
    deal_type: 'Purchase',
    last_purchase_date: daysAgo(10),
    last_service_date: daysAgo(200),
    trade_in_inquiry: true,
    unit_age_at_purchase: '4',
  },
} as unknown as Contact;

function def(field: string, operator: string, value = '', value2?: string): FilterDefinition {
  return {
    version: 1,
    logic: 'AND',
    groups: [{ id: 'g', logic: 'AND', conditions: [{ id: 'r', field, operator: operator as never, value, value2 }] }],
  };
}
const matches = (d: FilterDefinition, c: Contact = contact) =>
  evaluateFilter([c], d, fields).length > 0;

describe('custom-field routing', () => {
  it('reads a select custom field', () => {
    expect(matches(def('deal_type', 'is_one_of', 'Purchase'))).toBe(true);
    expect(matches(def('deal_type', 'is_one_of', 'Lease'))).toBe(false);
  });
  it('reads a boolean custom field', () => {
    expect(matches(def('trade_in_inquiry', 'is_true'))).toBe(true);
  });
  it('reads a number custom field', () => {
    expect(matches(def('unit_age_at_purchase', 'num_gte', '3'))).toBe(true);
    expect(matches(def('unit_age_at_purchase', 'num_lt', '3'))).toBe(false);
  });
});

describe('tag operators', () => {
  it('includes_any matches a present tag', () => {
    expect(matches(def('tags', 'includes_any', 'loomi-yag-purchased'))).toBe(true);
  });
  it('excludes matches when tag absent', () => {
    expect(matches(def('tags', 'excludes', 'loomi-yag-new-purchase-active'))).toBe(true);
    expect(matches(def('tags', 'excludes', 'loomi-yag-purchased'))).toBe(false);
  });
});

// The engine is the last line of defence for filter JSON already sitting
// in the database, so every one of these has to narrow to nothing rather
// than fall through to "matches everyone" — which is what a blast or an
// ad-platform export would then act on.
describe('fail-closed semantics', () => {
  it('an operator from the wrong type family matches nobody', () => {
    // The re-typed-custom-field case: `last_service_date` was declared a
    // date, saved segments hold date operators, someone flips it to text.
    const retyped = getFilterableFields([
      { key: 'last_service_date', label: 'Last Service Date', type: 'text', category: 'custom' },
    ]);
    const d = def('last_service_date', 'more_than_days_ago', '166');
    expect(evaluateFilter([contact], d, retyped)).toHaveLength(0);
  });

  it('a value-taking operator with a blank value matches nobody', () => {
    // `contains ""` is true for every string — the classic fail-open.
    expect(matches(def('deal_type', 'is_one_of', ''))).toBe(false);
    expect(matches(def('unit_age_at_purchase', 'num_gte', '   '))).toBe(false);
  });

  it('a range operator missing its upper bound matches nobody', () => {
    expect(matches(def('last_purchase_date', 'between', daysAgo(30)))).toBe(false);
  });

  it('an unknown operator matches nobody', () => {
    expect(matches(def('deal_type', 'sounds_like', 'Purchase'))).toBe(false);
  });

  it('an empty definition matches nobody', () => {
    expect(evaluateFilter([contact], { version: 1, logic: 'AND', groups: [] }, fields)).toHaveLength(0);
  });

  it('a group with no conditions matches nobody', () => {
    const empty: FilterDefinition = {
      version: 1,
      logic: 'AND',
      groups: [{ id: 'g', logic: 'AND', conditions: [] }],
    };
    expect(evaluateFilter([contact], empty, fields)).toHaveLength(0);
  });

  it('still matches when the filter is genuinely satisfiable', () => {
    // Guard against over-correcting into "nothing ever matches".
    expect(matches(def('deal_type', 'is_one_of', 'Purchase'))).toBe(true);
  });
});

describe('relative-date operators (the new ones)', () => {
  it('within_last_days matches a recent past date', () => {
    expect(matches(def('last_purchase_date', 'within_last_days', '30'))).toBe(true);
    expect(matches(def('last_purchase_date', 'within_last_days', '5'))).toBe(false);
  });
  it('more_than_days_ago matches an old date', () => {
    expect(matches(def('last_service_date', 'more_than_days_ago', '166'))).toBe(true);
    expect(matches(def('last_service_date', 'more_than_days_ago', '365'))).toBe(false);
  });
  it('within_last_days does NOT match a future date', () => {
    const future = {
      id: 'c2',
      tags: [],
      customFields: { last_purchase_date: new Date(Date.now() + 5 * 86_400_000).toISOString() },
    } as unknown as Contact;
    expect(matches(def('last_purchase_date', 'within_last_days', '30'), future)).toBe(false);
  });
});

describe('relative-date bounds are calendar days, not 24h multiples', () => {
  // Regression: the bounds used to be `todayStart - days * 86400000`,
  // which lands at 23:00 (or 01:00) rather than midnight whenever the
  // span crosses a daylight-saving change. The engine floors the row's
  // date before comparing and the SQL translator doesn't, so those two
  // only agree when the bound is a real midnight — this diverged for
  // roughly half the year, and a differential test caught it only
  // because it happened to run after midnight.
  it('lands on midnight across a DST boundary', () => {
    // Mid-August (DST) back to mid-February (standard time).
    const august = new Date(2026, 7, 14, 0, 0, 0, 0);
    const back180 = addFilterDays(august, -180);

    expect(back180.getHours()).toBe(0);
    expect(back180.getMinutes()).toBe(0);
    expect(back180.getSeconds()).toBe(0);

    // …and forward across the other transition.
    const february = new Date(2026, 1, 15, 0, 0, 0, 0);
    const fwd180 = addFilterDays(february, 180);
    expect(fwd180.getHours()).toBe(0);
  });

  it('a 24h-multiple shift does NOT, which is the bug', () => {
    const august = new Date(2026, 7, 14, 0, 0, 0, 0);
    const naive = new Date(august.getTime() - 180 * 86_400_000);
    // Pins the difference so nobody "simplifies" the helper back.
    expect(naive.getHours()).not.toBe(0);
  });
});
