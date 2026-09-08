import { describe, it, expect } from 'vitest';
import {
  ADDITIONAL_EMAILS_FIELD,
  UNPARSED_EMAIL_FIELD,
  autoMapHeaders,
  isAmbiguousEmailCell,
  isPlaceholderEmail,
  normaliseEmail,
  normaliseRow,
  parseEmailCell,
} from './normalize';

describe('parseEmailCell', () => {
  // The powersports feed packs every address it holds for a person into the
  // one email field. Stored whole, that string was the send target, the
  // (accountKey, email) dedup key, and what a segment export printed.
  it('unpacks a delimiter-joined cell', () => {
    expect(parseEmailCell('bluejenkins1@yahoo.com;donald.jenkins@gmail.com').addresses).toEqual([
      'bluejenkins1@yahoo.com',
      'donald.jenkins@gmail.com',
    ]);
    expect(parseEmailCell('a@x.com, b@y.com | c@z.com').addresses).toEqual([
      'a@x.com',
      'b@y.com',
      'c@z.com',
    ]);
  });

  it('dedupes the same address repeated', () => {
    // Real feed rows: "billy.m.porter@gmail.com;billy.m.porter@gmail.com".
    expect(parseEmailCell('Billy.M.Porter@gmail.com;billy.m.porter@GMAIL.com').addresses).toEqual([
      'billy.m.porter@gmail.com',
    ]);
  });

  it('treats a trailing delimiter as nothing, not as junk', () => {
    // "lovingmylife082209@gmail.com," — a stray comma, not a second address.
    const cell = parseEmailCell('lovingmylife082209@gmail.com,');
    expect(cell.addresses).toEqual(['lovingmylife082209@gmail.com']);
    expect(cell.dropped).toEqual([]);
    expect(isAmbiguousEmailCell(cell)).toBe(false);
  });

  it('ranks a real address above a placeholder in the same cell', () => {
    // Source order would have kept the placeholder and thrown away the only
    // address anyone could actually send to.
    expect(parseEmailCell('noneyet@none.com;markpantelakis@gmail.com').addresses).toEqual([
      'markpantelakis@gmail.com',
      'noneyet@none.com',
    ]);
    expect(parseEmailCell('kyler@steelworksfab.com;none@none.com').addresses).toEqual([
      'kyler@steelworksfab.com',
      'none@none.com',
    ]);
  });

  it('reports the parts that were not addresses', () => {
    expect(parseEmailCell('none').dropped).toEqual(['none']);
    expect(parseEmailCell('NULL;real@x.com').dropped).toEqual(['NULL']);
    expect(parseEmailCell('missing@domain').dropped).toEqual(['missing@domain']);
    expect(parseEmailCell('  ').dropped).toEqual([]);
  });
});

describe('isPlaceholderEmail', () => {
  it('spots the "we have no address" markers', () => {
    expect(isPlaceholderEmail('none@none.com')).toBe(true);
    expect(isPlaceholderEmail('noneyet@none.com')).toBe(true);
    expect(isPlaceholderEmail('email@email.com')).toBe(true);
    expect(isPlaceholderEmail('test@anything.co')).toBe(true);
  });

  it('leaves real addresses alone', () => {
    expect(isPlaceholderEmail('markpantelakis@gmail.com')).toBe(false);
    expect(isPlaceholderEmail('kyler@steelworksfab.com')).toBe(false);
  });
});

describe('isAmbiguousEmailCell', () => {
  // "calie,hammond@youngsubaru.com" is a mistyped calie.hammond@ — keeping the
  // valid-looking half would invent a different, possibly real, person.
  it('flags a delimiter that landed inside one address', () => {
    expect(isAmbiguousEmailCell(parseEmailCell('calie,hammond@youngsubaru.com'))).toBe(true);
    expect(isAmbiguousEmailCell(parseEmailCell('NULL;real@x.com'))).toBe(true);
  });

  it('does not flag a clean list, or a cell with no address at all', () => {
    expect(isAmbiguousEmailCell(parseEmailCell('a@x.com;b@y.com'))).toBe(false);
    expect(isAmbiguousEmailCell(parseEmailCell('none'))).toBe(false);
  });
});

describe('normaliseEmail', () => {
  it('trims and lowercases a single address', () => {
    expect(normaliseEmail('  Foo@Example.COM ')).toBe('foo@example.com');
  });

  it('keeps the best address of a packed cell', () => {
    expect(normaliseEmail('bluejenkins1@yahoo.com;donald.jenkins@gmail.com')).toBe(
      'bluejenkins1@yahoo.com',
    );
    expect(normaliseEmail('noneyet@none.com;markpantelakis@gmail.com')).toBe(
      'markpantelakis@gmail.com',
    );
  });

  // Junk used to pass straight through, so every contact whose CRM wrote
  // "none" collided on the (accountKey, email) unique index.
  it('rejects a cell that holds no address', () => {
    expect(normaliseEmail('none')).toBe('');
  });

  it('refuses to guess at an ambiguous cell', () => {
    expect(normaliseEmail('calie,hammond@youngsubaru.com')).toBe('');
  });
});

describe('normaliseRow email handling', () => {
  const mapping = autoMapHeaders(['Email', 'First Name', 'Phone']);

  it('stores one address and banks the alternates', () => {
    const { row } = normaliseRow(
      { Email: 'bluejenkins1@yahoo.com;donald.jenkins@gmail.com', 'First Name': 'Donald' },
      mapping,
      2,
    );
    expect(row?.email).toBe('bluejenkins1@yahoo.com');
    expect(row?.customFields?.[ADDITIONAL_EMAILS_FIELD]).toBe('donald.jenkins@gmail.com');
  });

  it('leaves customFields alone for an ordinary single address', () => {
    const { row } = normaliseRow({ Email: 'solo@x.com', 'First Name': 'Solo' }, mapping, 2);
    expect(row?.email).toBe('solo@x.com');
    expect(row?.customFields).toBeNull();
  });

  it('parks an ambiguous cell verbatim instead of inventing an address', () => {
    const { row } = normaliseRow(
      { Email: 'calie,hammond@youngsubaru.com', Phone: '801-555-0134' },
      mapping,
      2,
    );
    expect(row?.email).toBeNull();
    expect(row?.customFields?.[UNPARSED_EMAIL_FIELD]).toBe('calie,hammond@youngsubaru.com');
    // The row survives on phone identity — nothing is lost.
    expect(row?.phone).toBe('+18015550134');
  });

  it('skips a row whose only identity was an unusable email', () => {
    const { row, issue } = normaliseRow({ Email: 'none', 'First Name': 'Nobody' }, mapping, 2);
    expect(row).toBeNull();
    expect(issue?.reason).toContain('no usable email or phone');
  });
});
