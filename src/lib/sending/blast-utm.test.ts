import { describe, expect, it } from 'vitest';
import { appendUtmParams, applyUtmTags, type BlastUtmSettings } from './blast-utm';

function utm(overrides?: Partial<BlastUtmSettings>): BlastUtmSettings {
  return {
    enabled: true,
    source: 'loomi',
    medium: 'email',
    campaign: 'august-lease',
    term: '',
    content: '',
    ...overrides,
  };
}

describe('applyUtmTags', () => {
  it('is a no-op when disabled', () => {
    const html = '<a href="https://audilayton.com/new">Shop</a>';
    expect(applyUtmTags(html, utm({ enabled: false }))).toBe(html);
  });

  it('is a no-op when the settings are absent', () => {
    const html = '<a href="https://audilayton.com/new">Shop</a>';
    expect(applyUtmTags(html, null)).toBe(html);
  });

  it('is a no-op when every field is blank', () => {
    const html = '<a href="https://audilayton.com/new">Shop</a>';
    expect(
      applyUtmTags(
        html,
        utm({ source: '', medium: '', campaign: '', term: '', content: '' }),
      ),
    ).toBe(html);
  });

  it('appends the populated params', () => {
    const out = applyUtmTags(
      '<a href="https://audilayton.com/new">Shop</a>',
      utm(),
    );
    expect(out).toContain('utm_source=loomi');
    expect(out).toContain('utm_medium=email');
    expect(out).toContain('utm_campaign=august-lease');
    // Blank fields are omitted, not sent empty.
    expect(out).not.toContain('utm_term');
    expect(out).not.toContain('utm_content');
  });

  it('preserves an existing query string', () => {
    const out = applyUtmTags(
      '<a href="https://audilayton.com/new?model=q5">Shop</a>',
      utm(),
    );
    expect(out).toContain('model=q5');
    expect(out).toContain('utm_source=loomi');
  });

  it('preserves a fragment', () => {
    const out = applyUtmTags(
      '<a href="https://audilayton.com/new#offers">Shop</a>',
      utm(),
    );
    expect(out).toContain('#offers');
  });

  // A hand-tagged link in the template is a deliberate choice.
  it('does not overwrite a param the link already carries', () => {
    const out = applyUtmTags(
      '<a href="https://audilayton.com/new?utm_source=print">Shop</a>',
      utm(),
    );
    expect(out).toContain('utm_source=print');
    expect(out).not.toContain('utm_source=loomi');
    // The params it doesn't have still get added.
    expect(out).toContain('utm_medium=email');
  });

  it('leaves non-http schemes alone', () => {
    const html =
      '<a href="mailto:sales@audilayton.com">Email</a>'
      + '<a href="tel:+18015550100">Call</a>'
      + '<a href="#top">Top</a>';
    expect(applyUtmTags(html, utm())).toBe(html);
  });

  // The single most important case: mangling the unsubscribe URL would break
  // the one link that legally has to work.
  it('never touches a SendGrid substitution token', () => {
    const html = '<a href="[%unsubscribe_url%]">Unsubscribe</a>';
    expect(applyUtmTags(html, utm())).toBe(html);
  });

  it('never touches an unresolved mergetag URL', () => {
    const html = '<a href="{{unsubscribe_link}}">Unsubscribe</a>';
    expect(applyUtmTags(html, utm())).toBe(html);
  });

  it('tags several links in one body', () => {
    const out = applyUtmTags(
      '<a href="https://a.com/x">A</a><a href="https://b.com/y">B</a>',
      utm(),
    );
    expect(out.match(/utm_source=loomi/g)).toHaveLength(2);
  });

  it('handles single-quoted hrefs', () => {
    const out = applyUtmTags("<a href='https://audilayton.com/new'>Shop</a>", utm());
    expect(out).toContain('utm_source=loomi');
    expect(out).toContain("'");
  });

  it('preserves other attributes on the anchor', () => {
    const out = applyUtmTags(
      '<a class="btn" href="https://audilayton.com/new" target="_blank">Shop</a>',
      utm(),
    );
    expect(out).toContain('class="btn"');
    expect(out).toContain('target="_blank"');
  });

  it('leaves an unparseable href alone', () => {
    const html = '<a href="https://">Broken</a>';
    expect(applyUtmTags(html, utm())).toBe(html);
  });

  it('trims whitespace out of param values', () => {
    const out = applyUtmTags(
      '<a href="https://audilayton.com/new">Shop</a>',
      utm({ source: '  loomi  ' }),
    );
    expect(out).toContain('utm_source=loomi');
  });

  it('returns empty string for empty input', () => {
    expect(applyUtmTags('', utm())).toBe('');
  });
});

// ── Byte-for-byte preservation ──────────────────────────────────────────
//
// The first version round-tripped every link through `new URL()` and let
// URLSearchParams re-serialize the query. react-email writes `&` as `&amp;`
// in attributes, so `?make=Honda&amp;model=Accord` became ONE parameter named
// "amp;model"; `%20` turned into `+`, `,` into `%2C`, and signed links broke.

describe('applyUtmTags — preserving the original link', () => {
  const href = (html: string) => /href="([^"]*)"/.exec(html)?.[1] ?? '';

  it('keeps an &amp;-escaped multi-parameter query intact', () => {
    const out = applyUtmTags(
      '<a href="https://dealer.com/new?make=Honda&amp;model=Accord">Shop</a>',
      utm(),
    );
    expect(href(out)).toBe(
      'https://dealer.com/new?make=Honda&amp;model=Accord&amp;utm_source=loomi&amp;utm_medium=email&amp;utm_campaign=august-lease',
    );
    expect(out).not.toContain('amp%3B');
  });

  it('does not re-encode existing parameters', () => {
    const out = applyUtmTags(
      '<a href="https://dealer.com/search?q=red%20truck&amp;tags=a,b&amp;p=x+y">Shop</a>',
      utm(),
    );
    expect(href(out).startsWith('https://dealer.com/search?q=red%20truck&amp;tags=a,b&amp;p=x+y&amp;utm_source=')).toBe(true);
  });

  it('keeps the fragment last', () => {
    const out = applyUtmTags(
      '<a href="https://dealer.com/new?model=q5#offers">Shop</a>',
      utm(),
    );
    expect(href(out)).toBe(
      'https://dealer.com/new?model=q5&amp;utm_source=loomi&amp;utm_medium=email&amp;utm_campaign=august-lease#offers',
    );
  });

  it('encodes only the values it adds', () => {
    const out = applyUtmTags(
      '<a href="https://dealer.com/">Shop</a>',
      utm({ campaign: 'Fall Sale & Service' }),
    );
    expect(href(out)).toContain('utm_campaign=Fall%20Sale%20%26%20Service');
  });

  it('never overwrites an existing utm value, wherever it sits', () => {
    const out = applyUtmTags(
      '<a href="https://dealer.com/?a=1&amp;utm_campaign=print-mailer&amp;b=2">Shop</a>',
      utm(),
    );
    expect(href(out)).toContain('utm_campaign=print-mailer');
    expect(href(out)).not.toContain('utm_campaign=august-lease');
    expect(href(out)).toContain('utm_source=loomi');
  });

  it('leaves a link alone when it already carries every parameter', () => {
    const html =
      '<a href="https://dealer.com/?utm_source=a&amp;utm_medium=b&amp;utm_campaign=c">Shop</a>';
    expect(applyUtmTags(html, utm())).toBe(html);
  });

  it('skips signed URLs, which any added parameter would invalidate', () => {
    const html =
      '<a href="https://bucket.s3.amazonaws.com/flyer.pdf?X-Amz-Expires=600&amp;X-Amz-Signature=abc123">Flyer</a>';
    expect(applyUtmTags(html, utm())).toBe(html);
  });

  it('skips relative links and in-page anchors', () => {
    const html = '<a href="/specials">Specials</a><a href="#map">Map</a>';
    expect(applyUtmTags(html, utm())).toBe(html);
  });

  it('keeps the unsubscribe link untouched next to tagged links', () => {
    const out = applyUtmTags(
      '<a href="https://dealer.com/">Shop</a><a href="[%unsubscribe_url%]">Unsubscribe</a>',
      utm(),
    );
    expect(out).toContain('<a href="[%unsubscribe_url%]">Unsubscribe</a>');
    expect(out).toContain('utm_source=loomi');
  });

  it('handles a host with no path or an empty query', () => {
    expect(href(applyUtmTags('<a href="https://dealer.com">x</a>', utm({ medium: '', campaign: '' }))))
      .toBe('https://dealer.com?utm_source=loomi');
    expect(href(applyUtmTags('<a href="https://dealer.com/?">x</a>', utm({ medium: '', campaign: '' }))))
      .toBe('https://dealer.com/?utm_source=loomi');
  });

  it("escapes a single-quoted attribute's own quote character", () => {
    const out = applyUtmTags("<a href='https://dealer.com/o&#39;neil'>x</a>", utm({ medium: '', campaign: '' }));
    expect(out).toBe("<a href='https://dealer.com/o&#39;neil?utm_source=loomi'>x</a>");
  });
});

describe('appendUtmParams', () => {
  it('returns null for links it must not touch', () => {
    expect(appendUtmParams('mailto:a@b.com', [['utm_source', 'x']])).toBeNull();
    expect(appendUtmParams('https://{{location.website}}', [['utm_source', 'x']])).toBeNull();
    expect(appendUtmParams('https://', [['utm_source', 'x']])).toBeNull();
  });
});
