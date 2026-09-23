import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sanitizeInlineHtml, filterInlineStyle } from './sanitize-inline';
import { FieldConsent } from './components/fields';
import { ColumnsBlock } from './components/Columns';

// These cover the two form-builder fixes:
//  1. Consent/Text widgets render author-supplied links (sanitized).
//  2. Columns blocks emit the data attribute the responsive stylesheets
//     key off to stack on mobile — gated on the stackOnMobile toggle.

describe('sanitizeInlineHtml', () => {
  it('keeps anchors with safe hrefs', () => {
    const out = sanitizeInlineHtml('See our <a href="https://example.com/privacy">Privacy Policy</a>.');
    expect(out).toContain('<a');
    expect(out).toContain('href="https://example.com/privacy"');
    expect(out).toContain('Privacy Policy');
  });

  it('keeps mailto/tel links', () => {
    expect(sanitizeInlineHtml('<a href="mailto:a@b.com">mail</a>')).toContain('href="mailto:a@b.com"');
    expect(sanitizeInlineHtml('<a href="tel:+15551234567">call</a>')).toContain('href="tel:+15551234567"');
  });

  it('strips script tags and inline event handlers', () => {
    const out = sanitizeInlineHtml('hi<script>alert(1)</script><a href="#" onclick="steal()">x</a>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onclick');
  });

  it('strips javascript: hrefs', () => {
    const out = sanitizeInlineHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });

  it('drops disallowed block/embed tags but keeps their text', () => {
    const out = sanitizeInlineHtml('<div>keep me<iframe src="evil"></iframe></div>');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<div');
    expect(out).toContain('keep me');
  });

  it('keeps an authored link color', () => {
    const out = sanitizeInlineHtml('<a style="color:#197cc2" href="https://ex.com/privacy">Privacy</a>');
    expect(out).toContain('color: #197cc2');
    expect(out).toContain('href="https://ex.com/privacy"');
  });

  it('underlines links by default so they read as links under the CSS reset', () => {
    expect(sanitizeInlineHtml('<a href="https://ex.com">x</a>')).toContain('text-decoration: underline');
    expect(sanitizeInlineHtml('<a style="text-decoration: none" href="https://ex.com">x</a>')).not.toContain(
      'underline',
    );
  });

  it('opens web links in a new tab so a half-filled form survives the click', () => {
    const out = sanitizeInlineHtml('<a href="https://ex.com">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(sanitizeInlineHtml('<a href="https://ex.com" target="_self">x</a>')).toContain('target="_self"');
    expect(sanitizeInlineHtml('<a href="tel:+15551234567">x</a>')).not.toContain('target=');
  });

  it('does not leak its hooks into other DOMPurify callers', async () => {
    sanitizeInlineHtml('<a href="https://ex.com">x</a>');
    const { sanitizeBlockHtml } = await import('./components/Html');
    expect(sanitizeBlockHtml('<a href="https://ex.com">x</a>')).not.toContain('target=');
  });
});

describe('filterInlineStyle', () => {
  it('keeps text properties and drops everything else', () => {
    expect(filterInlineStyle('color: red; position: fixed; font-weight: 700')).toBe('color: red; font-weight: 700');
  });

  it('drops url() and other functions that could beacon out', () => {
    expect(filterInlineStyle('background-color: url(https://evil/x)')).toBe('');
    expect(filterInlineStyle('color: expression(alert(1))')).toBe('');
    expect(filterInlineStyle('color: rgb(25, 124, 194)')).toBe('color: rgb(25, 124, 194)');
  });

  it('ignores malformed declarations like color=#hex', () => {
    expect(filterInlineStyle('color=#197cc2')).toBe('');
  });
});

describe('FieldConsent', () => {
  it('renders an embedded link instead of escaping it', () => {
    const html = renderToStaticMarkup(
      React.createElement(FieldConsent, {
        label: 'I agree. See our <a href="https://ex.com/privacy">Privacy Policy</a>.',
        required: true,
      }),
    );
    // A real anchor tag, not escaped &lt;a&gt;
    expect(html).toContain('<a href="https://ex.com/privacy"');
    expect(html).not.toContain('&lt;a');
    // Required asterisk still renders alongside the sanitized body.
    expect(html).toContain('*');
  });

  it('sanitizes malicious consent markup', () => {
    const html = renderToStaticMarkup(
      React.createElement(FieldConsent, {
        label: 'ok<script>alert(1)</script>',
      }),
    );
    expect(html).not.toContain('<script');
  });
});

describe('ColumnsBlock', () => {
  it('emits data-form-columns-row when stackOnMobile is on (default)', () => {
    const html = renderToStaticMarkup(
      React.createElement(ColumnsBlock, { children: React.createElement('span', null, 'c') }),
    );
    expect(html).toContain('data-form-columns-row');
  });

  it('omits data-form-columns-row when stackOnMobile is off', () => {
    const html = renderToStaticMarkup(
      React.createElement(ColumnsBlock, {
        stackOnMobile: false,
        children: React.createElement('span', null, 'c'),
      }),
    );
    expect(html).not.toContain('data-form-columns-row');
  });
});
