import { describe, expect, it } from 'vitest';
import { formatFromLine, fromDisplayName } from './blast-sender';

// The builder showed "senderName || account name" while the send used the
// sender name alone. One function now decides both.
describe('fromDisplayName', () => {
  it('prefers the sender name, then the account name', () => {
    expect(fromDisplayName({ senderName: 'Service Team', dealer: 'Audi Layton' })).toBe('Service Team');
    expect(fromDisplayName({ senderName: '', dealer: 'Audi Layton' })).toBe('Audi Layton');
    expect(fromDisplayName({ senderName: null, dealer: 'Audi Layton' })).toBe('Audi Layton');
  });

  it('treats a whitespace-only sender name as unset', () => {
    expect(fromDisplayName({ senderName: '   ', dealer: ' Audi Layton ' })).toBe('Audi Layton');
  });

  it('is empty when neither is set', () => {
    expect(fromDisplayName({})).toBe('');
    expect(fromDisplayName(null)).toBe('');
  });
});

describe('formatFromLine', () => {
  it('formats name and address the way a mail client shows them', () => {
    expect(formatFromLine({ dealer: 'Audi Layton', senderEmail: 'hi@audi.test' })).toBe(
      'Audi Layton <hi@audi.test>',
    );
    expect(formatFromLine({ senderEmail: 'hi@audi.test' })).toBe('hi@audi.test');
    expect(formatFromLine({ dealer: 'Audi Layton' })).toBe('Audi Layton');
  });
});
