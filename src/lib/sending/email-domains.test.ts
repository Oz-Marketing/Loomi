import { describe, expect, it } from 'vitest';
import { classifyEmail, describeRejection } from './email-domains';
import { isLikelyDeliverableEmail } from '@/lib/contact-hygiene';

describe('classifyEmail — real addresses', () => {
  // The regression that matters most. An early version of the production
  // survey used a fuzzy "looks like gmail" pattern and matched gmail.com
  // itself, which would have suppressed 149,265 real contacts.
  it('never rejects the big free providers', () => {
    for (const domain of [
      'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
      'icloud.com', 'me.com', 'msn.com', 'live.com', 'comcast.net',
      'att.net', 'verizon.net', 'googlemail.com',
    ]) {
      expect(classifyEmail(`someone@${domain}`), domain).toBeNull();
    }
  });

  it('accepts ordinary business domains', () => {
    for (const email of [
      'sales@youngautomotive.com',
      'first.last@ozmktg.com',
      'a@b.co',
      'person@sub.domain.co.uk',
      'x+tag@ozdealertools.io',
      'someone@email.net',
    ]) {
      expect(classifyEmail(email), email).toBeNull();
    }
  });

  it('rejects RFC 2606 reserved domains, which can never receive mail', () => {
    expect(classifyEmail('a@example.com')).toBe('placeholder');
    expect(classifyEmail('b@example.org')).toBe('placeholder');
  });

  it('accepts .co, which is a real TLD and not a .com typo', () => {
    // Colombia's TLD, and a common startup domain. Only .co paired with a
    // known provider name is treated as a typo.
    expect(classifyEmail('founder@startup.co')).toBeNull();
  });
});

describe('classifyEmail — rejections', () => {
  it('rejects placeholder domains', () => {
    for (const email of [
      'a@none.com', 'b@noemail.com', 'c@na.com', 'd@test.com',
      'e@fake.gov', 'f@none.cm', 'g@unknown.com', 'h@nomail.com',
    ]) {
      expect(classifyEmail(email), email).toBe('placeholder');
    }
  });

  it('rejects TLDs that do not exist', () => {
    for (const email of [
      'a@gmail.con', 'b@yahoo.cm', 'c@aol.vom', 'd@gmail.c0m',
      'e@wilsonpaintandfloors.om', 'f@ziprider.con', 'g@msn.ocm',
    ]) {
      expect(classifyEmail(email), email).toBe('invalid-tld');
    }
  });

  it('rejects misspelled providers', () => {
    for (const email of [
      'a@gmial.com', 'b@gamil.com', 'c@gmai.com', 'd@gmal.com',
      'e@gnail.com', 'f@yaho.com', 'g@hotmial.com', 'h@iclould.com',
      'i@gmail.co', 'j@hotmail.co', 'k@yahoo.co',
    ]) {
      expect(classifyEmail(email), email).toBe('provider-typo');
    }
  });

  it('rejects values holding more than one address', () => {
    expect(classifyEmail('a@gmail.com;b@yahoo.com')).toBe('unparseable');
    expect(classifyEmail('a@gmail.com,b@yahoo.com')).toBe('unparseable');
  });

  it('rejects a stray delimiter inside one address', () => {
    // The rows the packed-email repair refused to guess at.
    expect(classifyEmail('calie,hammond@youngsubaru.com')).toBe('unparseable');
    expect(classifyEmail('torrilla,@gmail.com')).toBe('unparseable');
    expect(classifyEmail('cydsi,ank@yahoo.com')).toBe('unparseable');
  });

  it('rejects malformed values', () => {
    for (const email of ['', '   ', 'not-an-email', 'trailing@', '@leading.com', 'no-at-sign.com']) {
      expect(classifyEmail(email), JSON.stringify(email)).toBe('syntax');
    }
  });

  it('rejects disposable inboxes', () => {
    expect(classifyEmail('a@mailinator.com')).toBe('disposable');
    expect(classifyEmail('b@yopmail.com')).toBe('disposable');
  });

  it('is case and whitespace insensitive', () => {
    expect(classifyEmail('  A@GMIAL.COM  ')).toBe('provider-typo');
    expect(classifyEmail('  A@GMAIL.COM  ')).toBeNull();
  });
});

describe('isLikelyDeliverableEmail', () => {
  it('agrees with classifyEmail', () => {
    expect(isLikelyDeliverableEmail('real@gmail.com')).toBe(true);
    expect(isLikelyDeliverableEmail('typo@gmial.com')).toBe(false);
    expect(isLikelyDeliverableEmail('placeholder@none.com')).toBe(false);
    expect(isLikelyDeliverableEmail('')).toBe(false);
  });

  it('still rejects the disposable domains it always rejected', () => {
    expect(isLikelyDeliverableEmail('a@mailinator.com')).toBe(false);
  });
});

describe('describeRejection', () => {
  it('has copy for every reason', () => {
    const reasons = [
      'syntax', 'unparseable', 'placeholder', 'invalid-tld',
      'provider-typo', 'disposable',
    ] as const;
    for (const r of reasons) {
      expect(describeRejection(r).length).toBeGreaterThan(0);
    }
  });
});
