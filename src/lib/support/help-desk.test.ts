import { describe, expect, it } from 'vitest';
import {
  HELP_DESK_COLUMNS,
  buildColumnValues,
  buildDetailsBody,
  buildItemName,
  matchLocationLabel,
  type SupportRequestInput,
} from '@/lib/support/help-desk';

/** The real Location labels on board 9778139049, trimmed to the tricky ones. */
const BOARD_LOCATIONS = [
  'Young Caring For Our Young',
  'Audi Layton',
  'Young Buick GMC | Layton',
  'Young Chevrolet',
  'Young CDJR | Layton',
  'Young Ford | Ogden',
  'Young Honda',
  'Young Mazda | Ogden',
  'Young Powersports | Layton',
  'Truck & Trailer | Kaysville',
  'Oz Marketing',
  'Other',
];

function makeInput(overrides: Partial<SupportRequestInput> = {}): SupportRequestInput {
  return {
    subject: 'Export downloads an empty file',
    details: 'Clicked Export on the contacts table and the CSV came back with headers only.',
    requestType: 'Bug/Technical Issue',
    urgency: 'High',
    name: 'Connor Kelly',
    email: 'connor@ozmktg.com',
    surface: 'studio',
    ...overrides,
  };
}

describe('matchLocationLabel', () => {
  it('matches an exact name', () => {
    expect(matchLocationLabel('Young Chevrolet', BOARD_LOCATIONS)).toBe('Young Chevrolet');
  });

  it('matches when the board label is shorter than the Loomi account name', () => {
    // Loomi seeds "Young Honda Ogden"; the board only has "Young Honda".
    expect(matchLocationLabel('Young Honda Ogden', BOARD_LOCATIONS)).toBe('Young Honda');
  });

  it('ignores the pipe separators the board uses', () => {
    expect(matchLocationLabel('Young CDJR Layton', BOARD_LOCATIONS)).toBe('Young CDJR | Layton');
  });

  it('is case- and punctuation-insensitive', () => {
    expect(matchLocationLabel('truck & trailer, kaysville', BOARD_LOCATIONS)).toBe(
      'Truck & Trailer | Kaysville',
    );
  });

  it('prefers the most specific label when several could match', () => {
    // "Young Buick GMC | Layton" (3 tokens) beats nothing looser.
    expect(matchLocationLabel('Young Buick GMC Layton', BOARD_LOCATIONS)).toBe(
      'Young Buick GMC | Layton',
    );
  });

  it('refuses a single-word overlap rather than guessing', () => {
    // "Young Subaru" isn't on this list — matching it to "Young Chevrolet" on
    // the shared word "Young" would file the report against the wrong store.
    expect(matchLocationLabel('Young Subaru', BOARD_LOCATIONS)).toBeNull();
  });

  it('returns null for an unknown account or an empty label list', () => {
    expect(matchLocationLabel('Peak Outdoor Gear', BOARD_LOCATIONS)).toBeNull();
    expect(matchLocationLabel('Young Chevrolet', [])).toBeNull();
    expect(matchLocationLabel(undefined, BOARD_LOCATIONS)).toBeNull();
  });
});

describe('buildItemName', () => {
  it('uses the subject', () => {
    expect(buildItemName(makeInput())).toBe('Export downloads an empty file');
  });

  it('falls back when the subject is blank', () => {
    expect(buildItemName(makeInput({ subject: '   ' }))).toBe('Support request');
  });
});

describe('buildDetailsBody', () => {
  it('leads with what the person wrote, then the captured context', () => {
    const body = buildDetailsBody(
      makeInput({
        accountName: 'Young Chevrolet',
        pageUrl: 'https://studio.loomilm.com/contacts',
        userRole: 'admin',
        userAgent: 'Mozilla/5.0',
        viewport: '1440×900',
        submittedAt: '2026-08-14T18:00:00.000Z',
      }),
    );

    expect(body.startsWith('Clicked Export on the contacts table')).toBe(true);
    expect(body).toContain('— Submitted from Loomi —');
    expect(body).toContain('Reported by: Connor Kelly (connor@ozmktg.com)');
    expect(body).toContain('Role: admin');
    expect(body).toContain('Account: Young Chevrolet');
    expect(body).toContain('Surface: Loomi Studio');
    expect(body).toContain('Page: https://studio.loomilm.com/contacts');
    expect(body).toContain('Viewport: 1440×900');
  });

  it('omits context lines it has no value for', () => {
    const body = buildDetailsBody(makeInput());
    expect(body).not.toContain('Account:');
    expect(body).not.toContain('Page:');
    expect(body).not.toContain('Viewport:');
  });

  it('records the App surface as Loomi Projects', () => {
    expect(buildDetailsBody(makeInput({ surface: 'app' }))).toContain('Surface: Loomi Projects');
  });

  // Regression: monday sanitizes long-text as HTML, so an unescaped `<…>` is
  // deleted outright. Confirmed against the live board — the reporter's address
  // in `Name <email>` arrived as `Name `, with no error and no other damage.
  it('never emits raw angle brackets, so monday cannot strip content as a tag', () => {
    const body = buildDetailsBody(
      makeInput({
        details: 'The console shows "Unexpected token <" and the <div id="root"> never renders.',
      }),
    );

    expect(body).not.toContain('<');
    expect(body).not.toContain('>');
    // Every character survives — nothing is dropped, only re-glyphed.
    expect(body).toContain('Unexpected token ‹');
    expect(body).toContain('‹div id="root"›');
  });

  it('keeps the reporter address intact', () => {
    expect(buildDetailsBody(makeInput())).toContain('Connor Kelly (connor@ozmktg.com)');
  });
});

describe('buildColumnValues', () => {
  it('maps every required field onto its monday column', () => {
    const values = buildColumnValues(makeInput());

    expect(values[HELP_DESK_COLUMNS.requestType]).toEqual({ labels: ['Bug/Technical Issue'] });
    expect(values[HELP_DESK_COLUMNS.urgency]).toEqual({ label: 'High' });
    expect(values[HELP_DESK_COLUMNS.clientName]).toBe('Connor Kelly');
    expect(values[HELP_DESK_COLUMNS.clientEmail]).toEqual({
      email: 'connor@ozmktg.com',
      text: 'connor@ozmktg.com',
    });
    expect(values[HELP_DESK_COLUMNS.details]).toMatchObject({
      text: expect.stringContaining('Clicked Export'),
    });
  });

  it('strips formatting from the phone number monday stores', () => {
    const values = buildColumnValues(makeInput({ phone: '(801) 927-1774' }));
    expect(values[HELP_DESK_COLUMNS.phone]).toEqual({
      phone: '8019271774',
      countryShortName: 'US',
    });
  });

  it('omits the phone column entirely when no number was given', () => {
    expect(HELP_DESK_COLUMNS.phone in buildColumnValues(makeInput())).toBe(false);
    expect(HELP_DESK_COLUMNS.phone in buildColumnValues(makeInput({ phone: '   ' }))).toBe(false);
  });

  it('only sets Tool and Location when the caller resolved a real label', () => {
    const unresolved = buildColumnValues(makeInput());
    expect(HELP_DESK_COLUMNS.tool in unresolved).toBe(false);
    expect(HELP_DESK_COLUMNS.location in unresolved).toBe(false);

    const resolved = buildColumnValues(makeInput(), {
      toolLabel: 'Loomi Studio',
      locationLabel: 'Young Chevrolet',
    });
    expect(resolved[HELP_DESK_COLUMNS.tool]).toEqual({ labels: ['Loomi Studio'] });
    expect(resolved[HELP_DESK_COLUMNS.location]).toEqual({ labels: ['Young Chevrolet'] });
  });
});
