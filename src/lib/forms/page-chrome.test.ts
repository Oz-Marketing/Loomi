import { describe, expect, it } from 'vitest';
import { publicFormChromeCss, safeCssColor, FALLBACK_BODY_BG } from './page-chrome';

describe('safeCssColor', () => {
  it('accepts the color formats the builder produces', () => {
    for (const value of ['#fff', '#f5f5f5', '#ff00aa80', 'rgb(7, 1, 18)', 'rgba(0,0,0,.5)', 'hsl(210 40% 98%)', 'white', 'transparent']) {
      expect(safeCssColor(value)).toBe(value);
    }
  });

  it('trims incidental whitespace', () => {
    expect(safeCssColor('  #f5f5f5 ')).toBe('#f5f5f5');
  });

  it('rejects anything that could break out of the style block', () => {
    for (const value of ['red; } body { display:none', '#fff}</style><script>', 'url(https://x/y)', 'var(--background)']) {
      expect(safeCssColor(value)).toBe(FALLBACK_BODY_BG);
    }
  });

  it('falls back for a missing or non-string setting', () => {
    expect(safeCssColor(undefined)).toBe(FALLBACK_BODY_BG);
    expect(safeCssColor(null)).toBe(FALLBACK_BODY_BG);
    expect(safeCssColor(0x0)).toBe(FALLBACK_BODY_BG);
  });
});

describe('publicFormChromeCss', () => {
  it('goes transparent in an embed so the host page shows through', () => {
    // The bug this fixes: <body> kept the app's near-black background, so
    // any frame height beyond the form rendered as a black slab.
    const css = publicFormChromeCss({ embed: true, bodyBg: '#f5f5f5' });
    expect(css).toContain('background: transparent !important');
    expect(css).not.toContain('#f5f5f5');
  });

  it("paints the form's own background when served standalone", () => {
    const css = publicFormChromeCss({ embed: false, bodyBg: '#f5f5f5' });
    expect(css).toContain('background: #f5f5f5 !important');
  });

  it('releases the full-viewport body the app layout imposes', () => {
    // `flex` + `min-h-screen` pin <body> to the frame height, so the form
    // can never report a height smaller than the iframe it already has.
    const css = publicFormChromeCss({ embed: true, bodyBg: '#fff' });
    expect(css).toContain('min-height: 0 !important');
    expect(css).toContain('display: block !important');
  });

  it('does not interpolate a hostile background setting', () => {
    const css = publicFormChromeCss({
      embed: false,
      bodyBg: '#fff; } body { display: none',
    });
    expect(css).not.toContain('display: none');
    expect(css).toContain(`background: ${FALLBACK_BODY_BG} !important`);
  });
});
