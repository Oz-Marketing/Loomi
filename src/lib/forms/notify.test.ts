import { describe, it, expect } from 'vitest';
import type { Form, FormSubmission } from '@prisma/client';
import { buildHtml, buildText, parseNotificationEmails } from './notify';

const form = { name: 'Lead Magnet 3' } as Form;

function submissionWith(
  data: Record<string, unknown>,
  metadata: unknown = null,
): FormSubmission {
  return { data, metadata } as unknown as FormSubmission;
}

describe('parseNotificationEmails', () => {
  it('splits, trims, and de-duplicates', () => {
    expect(parseNotificationEmails(' a@x.com, b@x.com ,a@x.com, ')).toEqual([
      'a@x.com',
      'b@x.com',
    ]);
  });

  it('returns [] for empty/null', () => {
    expect(parseNotificationEmails(null)).toEqual([]);
    expect(parseNotificationEmails('')).toEqual([]);
  });
});

describe('lead notification — embed metadata', () => {
  const META = { vin: '1N4BL4CW0TN325199', stock: '25N0033' };

  it('adds a page-context table when the embed passed meta params', () => {
    const html = buildHtml(form, submissionWith({ email: 'a@x.com' }, META));
    expect(html).toContain('Page context');
    expect(html).toContain('1N4BL4CW0TN325199');
    expect(html).toContain('25N0033');
  });

  it('adds the same context to the plain-text part', () => {
    const text = buildText(form, submissionWith({ email: 'a@x.com' }, META));
    expect(text).toContain('Page context:');
    expect(text).toContain('vin: 1N4BL4CW0TN325199');
  });

  it('omits the section when there is no metadata', () => {
    expect(buildHtml(form, submissionWith({ email: 'a@x.com' }))).not.toContain(
      'Page context',
    );
    expect(buildText(form, submissionWith({ email: 'a@x.com' }))).not.toContain(
      'Page context',
    );
  });
});

describe('lead notification — escaping untrusted content', () => {
  it('escapes metadata lifted from the host page', () => {
    const html = buildHtml(
      form,
      submissionWith({ email: 'a@x.com' }, { vin: '<script>alert(1)</script>' }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes quotes, so a file URL cannot break out of its href attribute', () => {
    const html = buildHtml(
      form,
      submissionWith({
        doc: [
          {
            url: 'https://cdn.example.com/a.pdf" onmouseover="alert(1)',
            name: 'a.pdf',
            size: 1,
            type: 'application/pdf',
          },
        ],
      }),
    );
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain('&quot;');
  });

  it('escapes submitted field values and field keys alike', () => {
    const html = buildHtml(
      form,
      submissionWith({ '<b>key</b>': '<img src=x onerror=alert(1)>' }),
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;b&gt;key&lt;/b&gt;');
  });

  it('treats a metadata column that is not a string map as absent', () => {
    expect(buildHtml(form, submissionWith({ a: 'b' }, 'junk'))).not.toContain(
      'Page context',
    );
    expect(buildHtml(form, submissionWith({ a: 'b' }, { n: 5 }))).not.toContain(
      'Page context',
    );
  });
});
