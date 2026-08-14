// Fixed-vector tests for identity normalisation + hashing.
//
// These pin the exact bytes we send to an ad platform. A change here
// silently changes match rate — nothing errors, the audience just comes
// back smaller — so the hashes are hard-coded rather than computed by
// re-running the implementation against itself.
//
// `973dfe46…` for "test@example.com" is the value published in
// platform documentation, which is what makes it a useful anchor: if our
// pipeline produces it, the encoding and digest are right.

import { describe, it, expect } from 'vitest';
import {
  hasAnyIdentifier,
  hashContactIdentifiers,
  identityDedupeKey,
  normalizeCountryCode,
  normalizeEmailForHash,
  normalizeNameForHash,
  normalizePhoneForHash,
  normalizePostalCode,
  sha256Hex,
} from './identity';

const HASH_TEST_EMAIL =
  '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b';

describe('sha256Hex', () => {
  it('matches the published vector for test@example.com', () => {
    expect(sha256Hex('test@example.com')).toBe(HASH_TEST_EMAIL);
  });
});

describe('email normalisation', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmailForHash('  TEST@Example.COM ')).toBe('test@example.com');
    expect(sha256Hex(normalizeEmailForHash('  TEST@Example.COM '))).toBe(HASH_TEST_EMAIL);
  });

  it('does NOT strip gmail dots or +tags', () => {
    // Over-normalising turns a matchable address into an unmatchable one.
    expect(normalizeEmailForHash('First.Last+ads@gmail.com')).toBe(
      'first.last+ads@gmail.com',
    );
  });

  it('is empty for missing input', () => {
    expect(normalizeEmailForHash(null)).toBe('');
    expect(normalizeEmailForHash(undefined)).toBe('');
  });
});

describe('phone normalisation', () => {
  it('adds the country code to a bare 10-digit number', () => {
    expect(normalizePhoneForHash('(212) 555-0123')).toBe('12125550123');
  });

  it('keeps an existing country code', () => {
    expect(normalizePhoneForHash('+1 212-555-0123')).toBe('12125550123');
    expect(normalizePhoneForHash('12125550123')).toBe('12125550123');
  });

  it('preserves a non-US country code when one was given', () => {
    expect(normalizePhoneForHash('+44 20 7946 0958')).toBe('442079460958');
  });

  it('drops numbers with no reliable country code rather than guessing', () => {
    // A 7-digit local number hashed without a country code matches
    // nothing — better to send no identifier than a wrong one.
    expect(normalizePhoneForHash('555-0123')).toBe('');
    expect(normalizePhoneForHash('12345')).toBe('');
    expect(normalizePhoneForHash('')).toBe('');
    expect(normalizePhoneForHash(null)).toBe('');
  });
});

describe('name normalisation', () => {
  it('folds case, punctuation and whitespace together', () => {
    expect(normalizeNameForHash("O'Neil")).toBe('oneil');
    expect(normalizeNameForHash('  ONEIL  ')).toBe('oneil');
    expect(normalizeNameForHash('Mc Donald')).toBe('mcdonald');
  });

  it('strips accents so José matches Jose', () => {
    expect(normalizeNameForHash('José')).toBe('jose');
    expect(normalizeNameForHash('JOSE')).toBe('jose');
  });

  it('drops prefixes and suffixes', () => {
    expect(normalizeNameForHash('Dr. Gregory')).toBe('gregory');
    expect(normalizeNameForHash('Ward Jr.')).toBe('ward');
    expect(normalizeNameForHash('Ward III')).toBe('ward');
  });
});

describe('postal code normalisation', () => {
  it('takes the 5-digit prefix for US ZIP+4', () => {
    expect(normalizePostalCode('84401-1234', 'US')).toBe('84401');
    expect(normalizePostalCode('84401', 'USA')).toBe('84401');
  });

  it('keeps international formats, minus spacing', () => {
    expect(normalizePostalCode('K1A 0B1', 'CA')).toBe('k1a0b1');
    expect(normalizePostalCode('SW1A 1AA', 'GB')).toBe('sw1a1aa');
  });

  it('is empty for missing input', () => {
    expect(normalizePostalCode('', 'US')).toBe('');
    expect(normalizePostalCode(null, null)).toBe('');
  });
});

describe('country normalisation', () => {
  it('maps the spellings dealer CRMs actually emit', () => {
    expect(normalizeCountryCode('USA')).toBe('US');
    expect(normalizeCountryCode('United States')).toBe('US');
    expect(normalizeCountryCode('us')).toBe('US');
    expect(normalizeCountryCode('Canada')).toBe('CA');
  });

  it('returns empty rather than guessing at an unknown value', () => {
    expect(normalizeCountryCode('Freedonia')).toBe('');
    expect(normalizeCountryCode('')).toBe('');
  });
});

describe('hashContactIdentifiers', () => {
  it('hashes each identifier the platform accepts', () => {
    const result = hashContactIdentifiers({
      email: '  TEST@Example.COM ',
      phone: '(212) 555-0123',
      firstName: 'José',
      lastName: "O'Neil",
      postalCode: '84401-1234',
      country: 'USA',
    });

    expect(result.hashedEmail).toBe(HASH_TEST_EMAIL);
    expect(result.hashedPhone).toBe(sha256Hex('12125550123'));
    expect(result.address).toEqual({
      hashedFirstName: sha256Hex('jose'),
      hashedLastName: sha256Hex('oneil'),
      // Postal code and country travel UNHASHED.
      postalCode: '84401',
      countryCode: 'US',
    });
  });

  it('omits the address block unless every part is present', () => {
    const noZip = hashContactIdentifiers({
      email: 'a@b.com',
      firstName: 'Ana',
      lastName: 'Reyes',
      country: 'US',
    });
    expect(noZip.address).toBeNull();
    expect(noZip.hashedEmail).not.toBeNull();

    const noCountry = hashContactIdentifiers({
      firstName: 'Ana',
      lastName: 'Reyes',
      postalCode: '84401',
    });
    expect(noCountry.address).toBeNull();
  });

  it('never hashes an empty value into an identifier', () => {
    const empty = hashContactIdentifiers({ email: '   ', phone: null });
    expect(empty.hashedEmail).toBeNull();
    expect(empty.hashedPhone).toBeNull();
    expect(empty.address).toBeNull();
    expect(hasAnyIdentifier(empty)).toBe(false);
  });
});

describe('identityDedupeKey', () => {
  it('collapses the same person across sub-accounts', () => {
    // One customer, three rooftops, three Contact rows — but one person
    // as far as the ad platform is concerned.
    const a = hashContactIdentifiers({ email: 'Sam@Example.com', phone: '2125550123' });
    const b = hashContactIdentifiers({ email: 'sam@example.com ', phone: null });
    expect(identityDedupeKey(a)).toBe(identityDedupeKey(b));
  });

  it('prefers email, falls back to phone', () => {
    const emailOnly = hashContactIdentifiers({ email: 'sam@example.com' });
    const phoneOnly = hashContactIdentifiers({ phone: '+1 212 555 0123' });
    expect(identityDedupeKey(emailOnly)).toBe(`e:${sha256Hex('sam@example.com')}`);
    expect(identityDedupeKey(phoneOnly)).toBe(`p:${sha256Hex('12125550123')}`);
  });

  it('is null when there is nothing to key on', () => {
    expect(identityDedupeKey(hashContactIdentifiers({}))).toBeNull();
  });
});
