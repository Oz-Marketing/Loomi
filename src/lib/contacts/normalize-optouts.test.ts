import { describe, expect, it } from 'vitest';
import {
  autoMapHeaders,
  isOptOutValue,
  normaliseRow,
  optOutTargetForHeader,
  type ImportTarget,
} from './normalize';

// A GoHighLevel export carries each contact's opt-outs as columns. Before
// these targets existed those columns fell into customFields: the import
// "succeeded" and every person on it who had opted out stayed mailable.

describe('optOutTargetForHeader', () => {
  it.each([
    ['DND', 'optout:all'],
    ['Do Not Disturb', 'optout:all'],
    ['DND All', 'optout:all'],
    ['dnd_all', 'optout:all'],
    ['Opted Out', 'optout:all'],
    ['Opt-Out', 'optout:all'],
    ['Email DND', 'optout:email'],
    ['DND Email', 'optout:email'],
    ['Unsubscribed', 'optout:email'],
    ['Email Unsubscribed', 'optout:email'],
    ['email_opt_out', 'optout:email'],
    ['Email Opt Out', 'optout:email'],
    ['SMS DND', 'optout:sms'],
    ['DND SMS', 'optout:sms'],
    ['SMS Opt Out', 'optout:sms'],
    ['sms-opted-out', 'optout:sms'],
  ])('reads "%s" as %s, case- and space-insensitively', (header, target) => {
    expect(optOutTargetForHeader(header)).toBe(target);
  });

  it('leaves ordinary columns alone', () => {
    for (const header of ['Email', 'Phone', 'Email Opt In', 'Tags', 'Notes', '']) {
      expect(optOutTargetForHeader(header)).toBeNull();
    }
  });
});

describe('isOptOutValue', () => {
  it.each(['true', 'TRUE', 'Yes', 'y', '1', 'X', 'on', 'active', 'Permanent', 'DND', 'Unsubscribed', 'opted out', 'Opted-Out', 'stop'])(
    'reads "%s" as opted out',
    (value) => {
      expect(isOptOutValue(value)).toBe(true);
    },
  );

  it.each(['', '  ', 'false', 'no', 'N', '0', 'inactive', 'subscribed', '2', 'maybe'])(
    'reads "%s" as not opted out',
    (value) => {
      expect(isOptOutValue(value)).toBe(false);
    },
  );

  it('reads a date as the answer "yes, on this day"', () => {
    expect(isOptOutValue('2024-03-01')).toBe(true);
    expect(isOptOutValue('2024-03-01T12:00:00Z')).toBe(true);
    expect(isOptOutValue('3/1/2024')).toBe(true);
    // But not a bare number a loose date parse would call a year.
    expect(isOptOutValue('12')).toBe(false);
  });

  it('accepts real booleans', () => {
    expect(isOptOutValue(true)).toBe(true);
    expect(isOptOutValue(false)).toBe(false);
  });
});

describe('autoMapHeaders', () => {
  it('suggests opt-out targets for opt-out columns, more than one per target', () => {
    const mapping = autoMapHeaders(['Email', 'Phone', 'DND', 'Email DND', 'Email Unsubscribed', 'SMS DND']);
    expect(mapping).toEqual({
      Email: 'email',
      Phone: 'phone',
      DND: 'optout:all',
      'Email DND': 'optout:email',
      'Email Unsubscribed': 'optout:email',
      'SMS DND': 'optout:sms',
    });
  });
});

describe('normaliseRow opt-out columns', () => {
  const mapping: Record<string, ImportTarget> = {
    Email: 'email',
    Phone: 'phone',
    DND: 'optout:all',
    'Email DND': 'optout:email',
    'SMS DND': 'optout:sms',
  };

  it('a channel-less DND opts out of every channel', () => {
    const { row } = normaliseRow({ Email: 'a@x.com', DND: 'true' }, mapping, 2);
    expect(row?.dnd).toEqual({ email: true, sms: true });
  });

  it('a channel column opts out of just that channel', () => {
    expect(normaliseRow({ Email: 'a@x.com', 'Email DND': 'Yes' }, mapping, 2).row?.dnd).toEqual({ email: true });
    expect(normaliseRow({ Phone: '8015550134', 'SMS DND': 'active' }, mapping, 2).row?.dnd).toEqual({ sms: true });
  });

  it('a "no" sets nothing — it is never a reason to clear an opt-out', () => {
    const { row } = normaliseRow({ Email: 'a@x.com', DND: 'false', 'Email DND': 'no', 'SMS DND': '' }, mapping, 2);
    expect(row?.dnd).toBeNull();
  });

  it('keeps opt-out columns out of customFields', () => {
    const { row } = normaliseRow({ Email: 'a@x.com', DND: 'true' }, mapping, 2);
    expect(row?.customFields).toBeNull();
  });

  it('still needs an email or phone to be a row at all', () => {
    const { row, issue } = normaliseRow({ DND: 'true' }, mapping, 7);
    expect(row).toBeNull();
    expect(issue?.rowNumber).toBe(7);
  });
});
