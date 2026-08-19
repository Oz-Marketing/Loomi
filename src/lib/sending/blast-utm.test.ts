import { describe, expect, it } from 'vitest';
import { applyUtmTags, type BlastUtmSettings } from './blast-utm';

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
