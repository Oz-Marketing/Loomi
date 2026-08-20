import { describe, expect, it } from 'vitest';
import {
  buildUnsubscribeFooter,
  hasUnsubscribeToken,
  injectUnsubscribeFooter,
  UNSUBSCRIBE_TOKEN,
} from './unsubscribe-footer';

const ACCOUNT = {
  dealer: 'Young Chevrolet',
  address: '1080 W Riverdale Rd',
  city: 'Riverdale',
  state: 'UT',
  postalCode: '84405',
};

describe('buildUnsubscribeFooter', () => {
  it('includes the postal address and the unsubscribe token', () => {
    const footer = buildUnsubscribeFooter(ACCOUNT);
    expect(footer.html).toContain('1080 W Riverdale Rd');
    expect(footer.html).toContain('Riverdale, UT');
    expect(footer.html).toContain('84405');
    expect(footer.html).toContain(UNSUBSCRIBE_TOKEN);
    expect(footer.text).toContain(UNSUBSCRIBE_TOKEN);
  });

  it('drops the unsubscribe line but keeps the address when asked', () => {
    const footer = buildUnsubscribeFooter(ACCOUNT, {
      includeUnsubscribeLink: false,
    });
    expect(footer.html).toContain('1080 W Riverdale Rd');
    expect(footer.html).not.toContain(UNSUBSCRIBE_TOKEN);
    expect(footer.text).not.toContain(UNSUBSCRIBE_TOKEN);
  });

  it('escapes a dealer name that carries HTML', () => {
    const footer = buildUnsubscribeFooter({
      ...ACCOUNT,
      dealer: 'Young <script>alert(1)</script> Chevy',
    });
    expect(footer.html).not.toContain('<script>');
    expect(footer.html).toContain('&lt;script&gt;');
  });
});

describe('injectUnsubscribeFooter', () => {
  // THE REGRESSION THIS FILE EXISTS FOR: we used to hand SendGrid the
  // footer via subscription_tracking's html/text fields while ALSO setting
  // substitution_tag. SendGrid documents substitution_tag as overriding
  // both, so the footer never shipped and the postal address CAN-SPAM
  // requires never reached a single inbox. The footer is now injected into
  // the body here, so these assertions are what guarantee it goes out.
  it('puts the address in the body of a plain template', () => {
    const out = injectUnsubscribeFooter({
      html: '<html><body><p>Deals!</p></body></html>',
      text: 'Deals!',
      account: ACCOUNT,
    });
    expect(out.html).toContain('1080 W Riverdale Rd');
    expect(out.text).toContain('1080 W Riverdale Rd');
  });

  it('injects inside </body> rather than after it', () => {
    const out = injectUnsubscribeFooter({
      html: '<html><body><p>Deals!</p></body></html>',
      text: '',
      account: ACCOUNT,
    });
    expect(out.html.indexOf('1080 W Riverdale Rd')).toBeLessThan(
      out.html.indexOf('</body>'),
    );
    expect(out.html.endsWith('</body></html>')).toBe(true);
  });

  it('appends when the template is a bare fragment with no </body>', () => {
    const out = injectUnsubscribeFooter({
      html: '<p>Deals!</p>',
      text: 'Deals!',
      account: ACCOUNT,
    });
    expect(out.html.startsWith('<p>Deals!</p>')).toBe(true);
    expect(out.html).toContain(UNSUBSCRIBE_TOKEN);
  });

  it('adds an unsubscribe link when the template has none', () => {
    const out = injectUnsubscribeFooter({
      html: '<p>Deals!</p>',
      text: 'Deals!',
      account: ACCOUNT,
    });
    expect(hasUnsubscribeToken(out.html)).toBe(true);
  });

  it('does not add a second link when the designer placed their own', () => {
    // {{unsubscribe_link}} has already become the SendGrid tag by the time
    // the injector runs, which is exactly what it keys off.
    const out = injectUnsubscribeFooter({
      html: `<p>Deals!</p><a href="${UNSUBSCRIBE_TOKEN}">Unsubscribe</a>`,
      text: `Deals! Unsubscribe: ${UNSUBSCRIBE_TOKEN}`,
      account: ACCOUNT,
    });
    const occurrences = out.html.split(UNSUBSCRIBE_TOKEN).length - 1;
    expect(occurrences).toBe(1);
    // …but the address still ships. That's the non-negotiable part.
    expect(out.html).toContain('1080 W Riverdale Rd');
  });

  it('still ships a footer when the account has no address on file', () => {
    // Preflight blocks this case before a real send; the builder must not
    // throw or silently emit nothing if it ever gets here.
    const out = injectUnsubscribeFooter({
      html: '<p>Deals!</p>',
      text: 'Deals!',
      account: { dealer: 'Young Chevrolet', address: null, city: null, state: null, postalCode: null },
    });
    expect(out.html).toContain('Young Chevrolet');
    expect(out.html).toContain(UNSUBSCRIBE_TOKEN);
  });
});
