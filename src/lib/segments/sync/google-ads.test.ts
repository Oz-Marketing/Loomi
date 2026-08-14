// Payload-shape tests for the Customer Match adapter.
//
// No network: these cover the two pure translations where a mistake is
// silent rather than loud. A wrong field name doesn't throw — Google
// accepts the upload and matches nobody, and the failure shows up weeks
// later as an audience that mysteriously won't serve.

import { describe, it, expect } from 'vitest';
import { hashContactIdentifiers, identityDedupeKey } from '../identity';
import { dedupeKeyToIdentifier, toUserIdentifiers } from './google-ads';

describe('toUserIdentifiers', () => {
  it('uses the field names Google expects', () => {
    const identifiers = hashContactIdentifiers({
      email: 'Ana@Example.com',
      phone: '(801) 555-0100',
      firstName: 'Ana',
      lastName: 'Reyes',
      postalCode: '84401',
      country: 'US',
    });
    const out = toUserIdentifiers(identifiers);
    const keys = out.flatMap((entry) => Object.keys(entry));

    // hashedPhoneNumber, NOT hashedPhone — the shape our own type uses.
    expect(keys).toContain('hashedEmail');
    expect(keys).toContain('hashedPhoneNumber');
    expect(keys).toContain('addressInfo');
  });

  it('sends every address part together, with zip and country unhashed', () => {
    const identifiers = hashContactIdentifiers({
      email: null,
      phone: null,
      firstName: 'Ana',
      lastName: 'Reyes',
      postalCode: '84401',
      country: 'US',
    });
    const address = toUserIdentifiers(identifiers).find((e) => 'addressInfo' in e)
      ?.addressInfo as Record<string, string> | undefined;

    expect(address).toBeDefined();
    expect(Object.keys(address!).sort()).toEqual([
      'countryCode',
      'hashedFirstName',
      'hashedLastName',
      'postalCode',
    ]);
    // Postal code and country are matched in the clear — hashing them
    // would match nobody.
    expect(address!.postalCode).toBe('84401');
    expect(address!.countryCode).toBe('US');
    expect(address!.hashedFirstName).toMatch(/^[a-f0-9]{64}$/);
  });

  it('omits identifiers the contact does not have', () => {
    const identifiers = hashContactIdentifiers({
      email: 'solo@example.com',
      phone: null,
      firstName: null,
      lastName: null,
      postalCode: null,
      country: null,
    });
    const out = toUserIdentifiers(identifiers);
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0])).toEqual(['hashedEmail']);
  });

  it('produces nothing for a contact with no usable identifier', () => {
    const identifiers = hashContactIdentifiers({
      email: null,
      phone: null,
      firstName: 'Ana',
      lastName: null,
      postalCode: null,
      country: null,
    });
    expect(toUserIdentifiers(identifiers)).toHaveLength(0);
  });
});

describe('dedupeKeyToIdentifier', () => {
  it('round-trips an email identity back into a removal operation', () => {
    const identifiers = hashContactIdentifiers({
      email: 'ana@example.com',
      phone: null,
      firstName: null,
      lastName: null,
      postalCode: null,
      country: null,
    });
    const key = identityDedupeKey(identifiers);
    expect(dedupeKeyToIdentifier(key)).toEqual({
      hashedEmail: identifiers.hashedEmail,
    });
  });

  it('round-trips a phone identity', () => {
    const identifiers = hashContactIdentifiers({
      email: null,
      phone: '+18015550100',
      firstName: null,
      lastName: null,
      postalCode: null,
      country: null,
    });
    const key = identityDedupeKey(identifiers);
    expect(dedupeKeyToIdentifier(key)).toEqual({
      hashedPhoneNumber: identifiers.hashedPhone,
    });
  });

  it('returns null rather than a malformed identifier for unknown keys', () => {
    // A removal we can't express must be dropped, not guessed at — a
    // wrong hash would remove somebody else.
    expect(dedupeKeyToIdentifier(null)).toBeNull();
    expect(dedupeKeyToIdentifier('')).toBeNull();
    expect(dedupeKeyToIdentifier('x:whatever')).toBeNull();
  });
});
