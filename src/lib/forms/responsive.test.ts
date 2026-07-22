import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  blockHasResponsive,
  blockResponsiveClass,
  buildBlockResponsiveCss,
  RESPONSIVE_PROP_KEYS,
} from './responsive';
import { FormRenderer } from './render';
import { emptyFormTemplate, type Block, type FormTemplate } from './types';

function block(partial: Partial<Block>): Block {
  return { id: 'b1', type: 'text', props: {}, ...partial };
}

describe('blockHasResponsive', () => {
  it('is false for a plain block', () => {
    expect(blockHasResponsive(block({ props: { text: 'hi' } }))).toBe(false);
  });
  it('is true with a mobile override', () => {
    expect(blockHasResponsive(block({ mobile: { fontSize: 12 } }))).toBe(true);
  });
  it('is true with a hide flag', () => {
    expect(blockHasResponsive(block({ props: { hideOnMobile: true } }))).toBe(true);
    expect(blockHasResponsive(block({ props: { hideOnDesktop: true } }))).toBe(true);
  });
  it('ignores an empty mobile bag', () => {
    expect(blockHasResponsive(block({ mobile: {} }))).toBe(false);
  });
});

describe('buildBlockResponsiveCss', () => {
  const cls = blockResponsiveClass('b1');

  it('emits a mobile media rule with !important for overrides', () => {
    const css = buildBlockResponsiveCss(cls, block({ mobile: { fontSize: 12, align: 'center' } }));
    expect(css).toContain('@media (max-width:500px)');
    expect(css).toContain(`.${cls}`);
    expect(css).toContain('font-size:12px !important');
    expect(css).toContain('text-align:center !important');
  });

  it('maps spacing keys to CSS', () => {
    const css = buildBlockResponsiveCss(cls, block({ mobile: { marginBottom: 4, paddingTop: 8 } }));
    expect(css).toContain('margin-bottom:4px !important');
    expect(css).toContain('padding-top:8px !important');
  });

  it('adds display:none for hideOnMobile inside the max-width query', () => {
    const css = buildBlockResponsiveCss(cls, block({ props: { hideOnMobile: true } }))!;
    expect(css).toContain('@media (max-width:500px)');
    expect(css).toContain('display:none !important');
    expect(css).not.toContain('min-width');
  });

  it('adds a min-width query for hideOnDesktop', () => {
    const css = buildBlockResponsiveCss(cls, block({ props: { hideOnDesktop: true } }))!;
    expect(css).toContain('@media (min-width:501px)');
    expect(css).toContain('display:none !important');
  });

  it('returns null when there is nothing responsive', () => {
    expect(buildBlockResponsiveCss(cls, block({ props: { text: 'x' } }))).toBeNull();
  });

  it('skips unknown keys in the mobile bag', () => {
    const css = buildBlockResponsiveCss(cls, block({ mobile: { notAThing: 5, fontSize: 10 } }));
    expect(css).toContain('font-size:10px');
    expect(css).not.toContain('notAThing');
  });
});

describe('RESPONSIVE_PROP_KEYS', () => {
  it('covers the approved subset', () => {
    for (const k of ['fontSize', 'align', 'marginBottom', 'paddingTop', 'gap']) {
      expect(RESPONSIVE_PROP_KEYS.has(k)).toBe(true);
    }
  });
  it('excludes non-responsive props', () => {
    for (const k of ['label', 'name', 'color', 'hideOnMobile']) {
      expect(RESPONSIVE_PROP_KEYS.has(k)).toBe(false);
    }
  });
});

describe('FormRenderer responsive output', () => {
  function templateWith(b: Block): FormTemplate {
    return { ...emptyFormTemplate(), blocks: [b] };
  }

  it('attaches the scoped class + a <style> tag for a mobile override', () => {
    const html = renderToStaticMarkup(
      React.createElement(FormRenderer, {
        template: templateWith(
          block({ id: 'abc', type: 'text', props: { text: 'Hello' }, mobile: { fontSize: 11 } }),
        ),
      }),
    );
    const cls = blockResponsiveClass('abc');
    expect(html).toContain(`class="${cls}"`);
    expect(html).toContain('<style');
    expect(html).toContain('font-size:11px !important');
    // Desktop base size still rendered inline (unchanged).
    expect(html).toContain('Hello');
  });

  it('emits no style tag / class for a plain block', () => {
    const html = renderToStaticMarkup(
      React.createElement(FormRenderer, {
        template: templateWith(block({ id: 'plain', type: 'text', props: { text: 'Plain' } })),
      }),
    );
    expect(html).not.toContain('<style');
    expect(html).not.toContain(blockResponsiveClass('plain'));
  });
});
