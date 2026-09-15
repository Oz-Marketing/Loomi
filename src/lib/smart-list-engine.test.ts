import { describe, it, expect } from 'vitest';
import { addFilterDays, evaluateFilter, resolveFilterDateBound } from './smart-list-engine';
import {
  describeRelativeDate,
  formatRelativeDate,
  getFilterableFields,
  parseRelativeDate,
  type FilterDefinition,
} from './smart-list-types';
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

  // The bug only exists where the clock actually changes. CI runs in
  // UTC, where a 24h-multiple shift IS midnight and there is nothing to
  // catch — so this half is conditional, while the invariant above holds
  // in every zone. (A first version of this test asserted the difference
  // unconditionally and failed CI for exactly that reason.)
  const observesDst =
    new Date(2026, 0, 1).getTimezoneOffset() !==
    new Date(2026, 6, 1).getTimezoneOffset();

  it.skipIf(!observesDst)('a 24h-multiple shift does NOT, which is the bug', () => {
    const august = new Date(2026, 7, 14, 0, 0, 0, 0);
    const naive = new Date(august.getTime() - 180 * 86_400_000);
    // Pins the difference so nobody "simplifies" the helper back.
    expect(naive.getHours()).not.toBe(0);
  });
});

// ── Relative date VALUES ────────────────────────────────────────
//
// The other half of "relative": before/after/between take a token
// (`rel:-6:month`) in place of a literal date, so a segment means the
// same thing next quarter as it does today. These assert the token
// grammar, the calendar arithmetic, and — most importantly — that a
// literal date still resolves to exactly the instant it always did.

describe('relative date values', () => {
  const dated = (iso: string) =>
    ({ id: 'c', tags: [], customFields: { last_purchase_date: iso } }) as unknown as Contact;

  it('parses and rejects', () => {
    expect(parseRelativeDate('rel:-6:month')).toEqual({ amount: -6, unit: 'month' });
    expect(parseRelativeDate('rel:90:day')).toEqual({ amount: 90, unit: 'day' });
    expect(parseRelativeDate('rel:0:day')).toEqual({ amount: 0, unit: 'day' });
    expect(parseRelativeDate('2026-01-01')).toBeNull();
    expect(parseRelativeDate('rel:6:fortnight')).toBeNull();
    expect(parseRelativeDate('rel:99999:day')).toBeNull();
    expect(parseRelativeDate('rel:1.5:day')).toBeNull();
  });

  it('round-trips through format', () => {
    const value = { amount: -18, unit: 'month' } as const;
    expect(parseRelativeDate(formatRelativeDate(value))).toEqual(value);
  });

  it('reads back in words', () => {
    expect(describeRelativeDate({ amount: -6, unit: 'month' })).toBe('6 months ago');
    expect(describeRelativeDate({ amount: -1, unit: 'year' })).toBe('1 year ago');
    expect(describeRelativeDate({ amount: 90, unit: 'day' })).toBe('in 90 days');
    expect(describeRelativeDate({ amount: 0, unit: 'day' })).toBe('today');
  });

  it('"before N months ago" matches an older date and not a newer one', () => {
    const thirteenMonths = new Date();
    thirteenMonths.setMonth(thirteenMonths.getMonth() - 13);
    const oneMonth = new Date();
    oneMonth.setMonth(oneMonth.getMonth() - 1);

    const olderThanAYear = def('last_purchase_date', 'before', 'rel:-12:month');
    expect(matches(olderThanAYear, dated(thirteenMonths.toISOString()))).toBe(true);
    expect(matches(olderThanAYear, dated(oneMonth.toISOString()))).toBe(false);
  });

  it('"after N years ago" is the recency half of the same window', () => {
    const twoYears = new Date();
    twoYears.setFullYear(twoYears.getFullYear() - 2);
    const boughtSince = def('last_purchase_date', 'after', 'rel:-3:year');
    expect(matches(boughtSince, dated(twoYears.toISOString()))).toBe(true);

    const fourYears = new Date();
    fourYears.setFullYear(fourYears.getFullYear() - 4);
    expect(matches(boughtSince, dated(fourYears.toISOString()))).toBe(false);
  });

  it('between accepts a relative bound on either side, or a mix', () => {
    const eighteenMonths = new Date();
    eighteenMonths.setMonth(eighteenMonths.getMonth() - 18);
    const inWindow = dated(eighteenMonths.toISOString());

    expect(matches(def('last_purchase_date', 'between', 'rel:-3:year', 'rel:-1:year'), inWindow)).toBe(true);
    expect(matches(def('last_purchase_date', 'between', 'rel:-1:year', 'rel:0:day'), inWindow)).toBe(false);
    // Mixed: a fixed lower bound with a relative upper one.
    expect(matches(def('last_purchase_date', 'between', '2000-01-01', 'rel:-1:year'), inWindow)).toBe(true);
  });

  it('an upper bound covers the whole of its day', () => {
    // The row's timestamp is late in the day on the bound itself. With a
    // midnight upper bound this would miss, which is the shape of bug
    // that makes "between today and 90 days from now" quietly drop the
    // leases expiring ON day 90.
    const ninetyDays = addFilterDays(new Date(), 90);
    ninetyDays.setHours(17, 30, 0, 0);
    expect(
      matches(def('last_purchase_date', 'between', 'rel:0:day', 'rel:90:day'), dated(ninetyDays.toISOString())),
    ).toBe(true);
  });

  it('a relative token on a day-count operator matches nobody, never everybody', () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 3);
    // `within_last_days` wants a NUMBER. The validator rejects this at
    // save time; the engine is the backstop for JSON already stored.
    expect(matches(def('last_purchase_date', 'within_last_days', 'rel:-30:day'), dated(recent.toISOString()))).toBe(false);
  });

  it('month arithmetic clamps instead of spilling into the next month', () => {
    // 31 May − 3 months is 28/29 Feb, not 2/3 March. Left unclamped this
    // shifts a lapse window by three days for anyone who filters on a
    // month end.
    const may31 = new Date(2027, 4, 31, 0, 0, 0, 0);
    const back = resolveFilterDateBound('rel:-3:month', 'start', may31);
    expect(back?.getFullYear()).toBe(2027);
    expect(back?.getMonth()).toBe(1);
    expect(back?.getDate()).toBe(28);
  });

  it('leap day − 1 year lands on 28 February', () => {
    const leapDay = new Date(2028, 1, 29, 0, 0, 0, 0);
    const back = resolveFilterDateBound('rel:-1:year', 'start', leapDay);
    expect(back?.getFullYear()).toBe(2027);
    expect(back?.getMonth()).toBe(1);
    expect(back?.getDate()).toBe(28);
  });

  it('relative bounds land on midnight, like every other relative window', () => {
    const august = new Date(2026, 7, 14, 13, 45, 0, 0);
    const back = resolveFilterDateBound('rel:-26:week', 'start', august);
    expect(back?.getHours()).toBe(0);
    expect(back?.getMinutes()).toBe(0);
  });

  it('a literal date still resolves exactly as it did before relative values existed', () => {
    const literal = '2026-03-01T12:00:00.000Z';
    expect(resolveFilterDateBound(literal, 'start')?.toISOString()).toBe(literal);
    // `edge` must not touch a literal — otherwise every saved `between`
    // would silently widen by a day on upgrade.
    expect(resolveFilterDateBound(literal, 'end')?.toISOString()).toBe(literal);
  });
});
