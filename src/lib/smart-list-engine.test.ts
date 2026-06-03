import { describe, it, expect } from 'vitest';
import { evaluateFilter } from './smart-list-engine';
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
