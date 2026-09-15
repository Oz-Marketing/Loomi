import { describe, it, expect } from 'vitest';
import { buildContactsCsv, CONTACT_CSV_COLUMNS, CONTACT_CSV_SELECT } from './csv';

describe('contact CSV columns', () => {
  // A date-filtered segment can only be checked against its own export if
  // the export carries the dates it filtered on. It didn't until now, and
  // the absence is invisible until someone tries to verify a segment.
  it('carries the lifecycle dates segments filter on', () => {
    const keys = CONTACT_CSV_COLUMNS.map((c) => c.key);
    expect(keys).toContain('purchaseDate');
    expect(keys).toContain('lastServiceDate');
  });

  // Every column has to be selected or it silently exports blank.
  it('selects every column it renders', () => {
    const selected = new Set(Object.keys(CONTACT_CSV_SELECT));
    const derived = new Set(['fullName']); // built in buildContactsCsv
    for (const col of CONTACT_CSV_COLUMNS) {
      if (derived.has(col.key)) continue;
      expect(selected, `column '${col.key}' is rendered but not selected`).toContain(col.key);
    }
  });

  // Existing columns keep their positions: these files get opened in
  // spreadsheets built against the previous layout.
  it('appends new columns without reordering the old ones', () => {
    expect(CONTACT_CSV_COLUMNS.map((c) => c.label).slice(0, 16)).toEqual([
      'Full Name', 'First Name', 'Last Name', 'Email', 'Phone', 'Address',
      'City', 'State', 'Postal Code', 'Country', 'Source', 'Tags',
      'Date Added', 'Vehicle Year', 'Vehicle Make', 'Vehicle Model',
    ]);
  });

  it('renders dates as YYYY-MM-DD and nulls as empty', () => {
    const csv = buildContactsCsv([
      { firstName: 'A', lastName: 'B', tags: [],
        purchaseDate: new Date('2023-04-11T18:30:00Z'),
        lastServiceDate: new Date('2026-02-03T00:00:00Z') },
      { firstName: 'C', lastName: 'D', tags: [], purchaseDate: null, lastServiceDate: null },
    ]);
    const [header, first, second] = csv.split('\n');
    expect(header.endsWith(',Purchase Date,Last Service Date')).toBe(true);
    expect(first.endsWith(',2023-04-11,2026-02-03')).toBe(true);
    expect(second.endsWith(',,')).toBe(true);
  });
});
