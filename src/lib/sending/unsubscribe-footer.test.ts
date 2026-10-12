import { describe, expect, it } from 'vitest';
import {
  buildUnsubscribeFooter,
  contrastRatio,
  DEFAULT_FOOTER_CONFIG,
  footerContrastProblems,
  hasUnsubscribeToken,
  injectUnsubscribeFooter,
  resolveFooterConfig,
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

  it('offers exactly one unsubscribe link, and no preference-center promise', () => {
    // Both anchors used to point at the same token, so "manage your
    // preferences" was really a second Unsubscribe button.
    const footer = buildUnsubscribeFooter(ACCOUNT);
    expect(footer.html.split(UNSUBSCRIBE_TOKEN).length - 1).toBe(1);
    expect(footer.html.toLowerCase()).not.toContain('preferences');
    expect(footer.text.toLowerCase()).not.toContain('preferences');
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

describe('resolveFooterConfig', () => {
  // Values come from the database and a settings form, so nothing here is
  // trusted. Anything invalid must fall back rather than reach a style
  // attribute.
  it('returns the defaults for null or a non-object', () => {
    expect(resolveFooterConfig(null)).toEqual(DEFAULT_FOOTER_CONFIG);
    expect(resolveFooterConfig(undefined)).toEqual(DEFAULT_FOOTER_CONFIG);
  });

  it('accepts valid overrides', () => {
    const cfg = resolveFooterConfig({
      fontSizePx: 14,
      textColor: '#111111',
      align: 'left',
      showTopBorder: false,
      unsubscribeLabel: 'Opt out',
    });
    expect(cfg.fontSizePx).toBe(14);
    expect(cfg.textColor).toBe('#111111');
    expect(cfg.align).toBe('left');
    expect(cfg.showTopBorder).toBe(false);
    expect(cfg.unsubscribeLabel).toBe('Opt out');
    // Untouched fields keep the default.
    expect(cfg.linkColor).toBe(DEFAULT_FOOTER_CONFIG.linkColor);
  });

  it('rejects a non-hex color', () => {
    expect(resolveFooterConfig({ textColor: 'red' }).textColor).toBe(
      DEFAULT_FOOTER_CONFIG.textColor,
    );
    expect(
      resolveFooterConfig({ textColor: 'javascript:alert(1)' }).textColor,
    ).toBe(DEFAULT_FOOTER_CONFIG.textColor);
  });

  it('rejects a font stack that could break out of the style attribute', () => {
    const cfg = resolveFooterConfig({
      fontFamily: 'Helvetica;} body{display:none',
    });
    expect(cfg.fontFamily).toBe(DEFAULT_FOOTER_CONFIG.fontFamily);
  });

  it('clamps sizes instead of shipping them', () => {
    expect(resolveFooterConfig({ fontSizePx: 900 }).fontSizePx).toBe(24);
    expect(resolveFooterConfig({ fontSizePx: -5 }).fontSizePx).toBe(8);
    expect(resolveFooterConfig({ spacingTopPx: 5000 }).spacingTopPx).toBe(96);
  });

  it('rejects an unknown align value', () => {
    expect(resolveFooterConfig({ align: 'sideways' as never }).align).toBe('center');
  });

  it('falls back on blank copy but allows an explicit null background', () => {
    expect(resolveFooterConfig({ optInLine: '   ' }).optInLine).toBe(
      DEFAULT_FOOTER_CONFIG.optInLine,
    );
    expect(resolveFooterConfig({ backgroundColor: null }).backgroundColor).toBeNull();
  });
});

describe('buildUnsubscribeFooter — styling', () => {
  it('renders the default appearance when given no config', () => {
    // Only difference from the pre-config renderer is that the apostrophe
    // in the opt-in line is now an HTML entity, since the copy is
    // account-authored and therefore escaped. Renders identically.
    const html = buildUnsubscribeFooter(ACCOUNT).html;
    expect(html).toContain('font-size:11px');
    expect(html).toContain('text-align:center');
    expect(html).toContain('border-top:1px solid #e5e7eb');
    expect(html).toContain('You&#39;re receiving this email');
  });

  it('applies style overrides', () => {
    const html = buildUnsubscribeFooter(ACCOUNT, {
      config: {
        fontSizePx: 13,
        textColor: '#222222',
        linkColor: '#0055ff',
        align: 'left',
        showTopBorder: false,
        backgroundColor: '#fafafa',
      },
    }).html;
    expect(html).toContain('font-size:13px');
    expect(html).toContain('color:#222222');
    expect(html).toContain('color:#0055ff');
    expect(html).toContain('text-align:left');
    expect(html).toContain('background-color:#fafafa');
    expect(html).not.toContain('border-top');
  });

  it('substitutes {dealer} in custom copy', () => {
    const footer = buildUnsubscribeFooter(ACCOUNT, {
      config: { optInLine: 'Sent to you by {dealer} because you asked.' },
    });
    expect(footer.html).toContain('<strong>Young Chevrolet</strong>');
    expect(footer.html).toContain('Sent to you by');
    expect(footer.text).toContain('Sent to you by Young Chevrolet because you asked.');
  });

  it('escapes HTML in account-authored copy', () => {
    const footer = buildUnsubscribeFooter(ACCOUNT, {
      config: {
        optInLine: '<script>alert(1)</script> {dealer}',
        unsubscribeLabel: '<img src=x onerror=alert(1)>',
      },
    });
    expect(footer.html).not.toContain('<script>');
    expect(footer.html).not.toContain('<img');
    expect(footer.html).toContain('&lt;script&gt;');
  });

  it('cannot be configured to drop the address or the link', () => {
    // The whole point of a structured config: no combination of settings
    // removes a legally required element.
    const footer = buildUnsubscribeFooter(ACCOUNT, {
      config: {
        optInLine: 'x',
        unsubscribeLabel: 'y',
        fontSizePx: 8,
        showTopBorder: false,
      },
    });
    expect(footer.html).toContain('1080 W Riverdale Rd');
    expect(footer.html).toContain('84405');
    expect(footer.html).toContain(UNSUBSCRIBE_TOKEN);
  });

  it('passes the config through the injector', () => {
    const out = injectUnsubscribeFooter({
      html: '<p>Deals!</p>',
      text: 'Deals!',
      account: ACCOUNT,
      config: { align: 'right' },
    });
    expect(out.html).toContain('text-align:right');
  });
});

describe('injectUnsubscribeFooter — includeUnsubscribeLink override', () => {
  // The SMTP fallback cannot swap [%unsubscribe_url%] for a real URL —
  // only SendGrid's substitution_tag does that, and there is no
  // Loomi-hosted unsubscribe page to point at instead. Without this
  // override the raw token ships to the inbox as visible text.
  it('drops the link but keeps the postal address when forced off', () => {
    const out = injectUnsubscribeFooter({
      html: '<html><body><p>Deals!</p></body></html>',
      text: 'Deals!',
      account: ACCOUNT,
      includeUnsubscribeLink: false,
    });
    expect(out.html).not.toContain(UNSUBSCRIBE_TOKEN);
    expect(out.text).not.toContain(UNSUBSCRIBE_TOKEN);
    expect(out.html).toContain('1080 W Riverdale Rd');
    expect(out.text).toContain('1080 W Riverdale Rd');
  });

  it('leaves the default alone when omitted', () => {
    const out = injectUnsubscribeFooter({
      html: '<html><body><p>Deals!</p></body></html>',
      text: 'Deals!',
      account: ACCOUNT,
    });
    expect(out.html).toContain(UNSUBSCRIBE_TOKEN);
  });

  it('still emits one link when the body already carries the designer\'s', () => {
    // Forcing the link ON would double it up; blasts rely on the
    // already-linked rule, so the override must never be able to add one.
    const out = injectUnsubscribeFooter({
      html: `<html><body><a href="${UNSUBSCRIBE_TOKEN}">Opt out</a></body></html>`,
      text: '',
      account: ACCOUNT,
    });
    expect(out.html.split(UNSUBSCRIBE_TOKEN).length - 1).toBe(1);
  });
});

describe('injectUnsubscribeFooter — the text part always carries the unsubscribe URL', () => {
  // The bug: "already linked?" was decided from EITHER part, so a designer's
  // {{unsubscribe_link}} button in the HTML switched the footer link off in
  // BOTH parts — and the text part shipped with no unsubscribe URL at all.
  it('adds the link to the text part when only the HTML has the designer\'s link', () => {
    const out = injectUnsubscribeFooter({
      html: `<html><body><a href="${UNSUBSCRIBE_TOKEN}">Opt out</a></body></html>`,
      text: 'Deals this week!',
      account: ACCOUNT,
    });
    expect(out.html.split(UNSUBSCRIBE_TOKEN).length - 1).toBe(1);
    expect(out.text).toContain(`Unsubscribe: ${UNSUBSCRIBE_TOKEN}`);
  });

  it('does not repeat the link in a text part that already has it', () => {
    const out = injectUnsubscribeFooter({
      html: `<a href="${UNSUBSCRIBE_TOKEN}">Opt out</a>`,
      text: `Opt out (${UNSUBSCRIBE_TOKEN})`,
      account: ACCOUNT,
    });
    expect(out.text.split(UNSUBSCRIBE_TOKEN).length - 1).toBe(1);
  });

  it('gives an empty text part the full footer, link included', () => {
    const out = injectUnsubscribeFooter({
      html: `<a href="${UNSUBSCRIBE_TOKEN}">Opt out</a>`,
      text: '',
      account: ACCOUNT,
    });
    expect(out.text).toContain(UNSUBSCRIBE_TOKEN);
    expect(out.text).toContain('1080 W Riverdale Rd');
  });

  it('still keeps the link out of both parts when forced off', () => {
    const out = injectUnsubscribeFooter({
      html: '<p>Deals</p>',
      text: 'Deals',
      account: ACCOUNT,
      includeUnsubscribeLink: false,
    });
    expect(out.text).not.toContain(UNSUBSCRIBE_TOKEN);
    expect(out.html).not.toContain(UNSUBSCRIBE_TOKEN);
  });

  it('treats a forced-ON override like the default: never a second link', () => {
    const out = injectUnsubscribeFooter({
      html: `<a href="${UNSUBSCRIBE_TOKEN}">Opt out</a>`,
      text: '',
      account: ACCOUNT,
      includeUnsubscribeLink: true,
    });
    expect(out.html.split(UNSUBSCRIBE_TOKEN).length - 1).toBe(1);
  });
});

describe('footer legibility', () => {
  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 0);
    expect(contrastRatio('nope', '#fff')).toBeNull();
  });

  // A valid config can still hide the CAN-SPAM address: text the same color
  // as the background passes hex validation.
  it('falls back to the default colors when text matches the background', () => {
    const html = buildUnsubscribeFooter(ACCOUNT, {
      config: { textColor: '#222222', linkColor: '#222222', backgroundColor: '#222222' },
    }).html;
    // A text color, not the background-color declaration that contains it.
    expect(html).not.toMatch(/[;"]color:#222222/);
    expect(html).toContain('background-color:#222222');
    // The default gray reads on near-black, so that is what renders.
    expect(html).toContain(`color:${DEFAULT_FOOTER_CONFIG.textColor}`);
  });

  it('uses black or white when even the default would disappear', () => {
    const html = buildUnsubscribeFooter(ACCOUNT, {
      config: { textColor: '#6b7280', linkColor: '#6b7280', backgroundColor: '#6b7280' },
    }).html;
    expect(html).toMatch(/color:#(?:000000|ffffff);/);
  });

  it('judges a transparent footer against white', () => {
    const html = buildUnsubscribeFooter(ACCOUNT, {
      config: { textColor: '#ffffff', linkColor: '#fefefe', backgroundColor: null },
    }).html;
    expect(html).not.toContain('color:#ffffff');
    expect(html).not.toContain('color:#fefefe');
  });

  it('keeps a legible custom color', () => {
    const html = buildUnsubscribeFooter(ACCOUNT, { config: { textColor: '#111111', linkColor: '#0055ff' } }).html;
    expect(html).toContain('color:#111111');
    expect(html).toContain('color:#0055ff');
  });

  it('reports which colors are unreadable, for preflight', () => {
    expect(footerContrastProblems(null)).toEqual([]);
    expect(footerContrastProblems({ textColor: '#111111' })).toEqual([]);
    const problems = footerContrastProblems({ textColor: '#fafafa', linkColor: '#0055ff', backgroundColor: null });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ field: 'textColor', color: '#fafafa', background: '#ffffff' });
    expect(problems[0].ratio).toBeLessThan(3);
  });
});
