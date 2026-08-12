import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sanitizeBlockHtml, HtmlBlock } from './components/Html';
import { FormRenderer } from './render';
import { ALL_BLOCK_SCHEMAS, BLOCK_SCHEMAS, getDefaultProps } from './schemas';
import { BLOCK_COMPONENTS } from './components';
import { DEFAULT_FORM_SETTINGS, type FormTemplate } from './types';

// Covers the Custom HTML block: what its sanitizer keeps, what it must
// strip (anything that would break or hijack the surrounding <form>),
// and the renderer's drop-empty-block rule.

describe('html block registration', () => {
  it('is in the palette list, the schema map and the component map', () => {
    // ALL_BLOCK_SCHEMAS drives the editor palette; a block registered in
    // BLOCK_SCHEMAS alone would be draggable-by-nothing and invisible.
    expect(ALL_BLOCK_SCHEMAS.map((s) => s.type)).toContain('html');
    expect(BLOCK_SCHEMAS.html.category).toBe('layout');
    expect(BLOCK_COMPONENTS.html).toBeTruthy();
  });

  it('picks up the shared hide-on-device toggles', () => {
    const keys = BLOCK_SCHEMAS.html.props.map((p) => p.key);
    expect(keys).toContain('hideOnMobile');
    expect(keys).toContain('hideOnDesktop');
  });

  it('inserts with empty html so the block starts as a placeholder', () => {
    expect(getDefaultProps('html')).toMatchObject({ html: '' });
  });
});

describe('sanitizeBlockHtml', () => {
  it('keeps block markup, links and inline styles', () => {
    const out = sanitizeBlockHtml(
      '<div style="text-align:center"><h3>Hours</h3><p>Mon–Fri <a href="https://ex.com/map">Directions</a></p></div>',
    );
    expect(out).toContain('<div');
    expect(out).toContain('<h3>Hours</h3>');
    expect(out).toContain('style="text-align:center"');
    expect(out).toContain('href="https://ex.com/map"');
  });

  it('keeps images and tables', () => {
    const out = sanitizeBlockHtml(
      '<table><tr><td><img src="https://ex.com/a.png" alt="a"></td></tr></table>',
    );
    expect(out).toContain('<table');
    expect(out).toContain('<img');
    expect(out).toContain('src="https://ex.com/a.png"');
  });

  it('strips scripts, iframes and inline event handlers', () => {
    const out = sanitizeBlockHtml(
      '<p onclick="steal()">hi</p><script>alert(1)</script><iframe src="https://evil.com"></iframe>',
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('onclick');
    expect(out).toContain('hi');
  });

  it('strips javascript: URLs', () => {
    expect(sanitizeBlockHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
  });

  it('strips nested forms and stray inputs', () => {
    // A nested <form> is invalid HTML inside the public page's own
    // <form> and silently breaks submission; a hand-rolled <input>
    // would post a key the submit pipeline never validated.
    const out = sanitizeBlockHtml(
      '<form action="https://evil.com"><input name="email"><button>Go</button></form>',
    );
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<input');
    expect(out).not.toContain('<button');
  });
});

describe('HtmlBlock', () => {
  it('renders the sanitized markup', () => {
    const html = renderToStaticMarkup(
      React.createElement(HtmlBlock, { html: '<p class="note">Call us</p>' }),
    );
    expect(html).toContain('<p class="note">Call us</p>');
    expect(html).not.toContain('&lt;p');
  });

  it('shows the editor placeholder when empty', () => {
    const html = renderToStaticMarkup(React.createElement(HtmlBlock, { html: '' }));
    expect(html).toContain('Custom HTML');
  });
});

describe('FormRenderer + html block', () => {
  const template = (html: string): FormTemplate => ({
    version: '1',
    settings: { ...DEFAULT_FORM_SETTINGS },
    blocks: [{ id: 'b1', type: 'html', props: { html } }],
  });

  it('renders a populated html block on the public form', () => {
    const out = renderToStaticMarkup(React.createElement(FormRenderer, { template: template('<p>hi</p>') }));
    expect(out).toContain('<p>hi</p>');
  });

  it('drops an empty html block instead of shipping the placeholder', () => {
    const out = renderToStaticMarkup(React.createElement(FormRenderer, { template: template('   ') }));
    expect(out).not.toContain('Custom HTML');
  });
});
