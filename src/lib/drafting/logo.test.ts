import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { footerLogo, hexLuminance, opaqueLuminance } from './logo';

/** A 40×10 PNG: `color` artwork on a transparent ground. */
async function png(color: string): Promise<Buffer> {
  const art = await sharp({ create: { width: 30, height: 10, channels: 4, background: color } }).png().toBuffer();
  return sharp({ create: { width: 40, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, left: 5, top: 0 }])
    .png()
    .toBuffer();
}

describe('opaqueLuminance', () => {
  it('ignores transparent pixels', () => {
    const rgba = Uint8Array.from([255, 255, 255, 0, 0, 0, 0, 255]);
    expect(opaqueLuminance(rgba)).toBe(0);
    expect(opaqueLuminance(Uint8Array.from([255, 255, 255, 0]))).toBeNull();
  });
});

describe('hexLuminance', () => {
  it('reads three- and six-digit hex', () => {
    expect(hexLuminance('#fff')).toBeCloseTo(255);
    expect(hexLuminance('#000000')).toBe(0);
    expect(hexLuminance('rgb(0,0,0)')).toBeNull();
  });
});

describe('footerLogo', () => {
  const files: Record<string, Promise<Buffer>> = {
    'https://cdn/white.png': png('#ffffff'),
    'https://cdn/navy.png': png('#0b1f4b'),
  };
  const fetchBytes = (url: string) => files[url] ?? Promise.reject(new Error('404'));

  const both = { light: 'https://cdn/white.png', dark: 'https://cdn/navy.png' };

  it('puts dark artwork on a light footer, whatever slot it was uploaded to', async () => {
    // Young Chev: "light" holds the white logo, "dark" the navy one.
    expect(await footerLogo(both, '#ffffff', fetchBytes)).toBe('https://cdn/navy.png');
    expect(await footerLogo(both, '#eff1f5', fetchBytes)).toBe('https://cdn/navy.png');
    // The other reading of the labels.
    expect(await footerLogo({ light: 'https://cdn/navy.png', dark: 'https://cdn/white.png' }, '#ffffff', fetchBytes)).toBe('https://cdn/navy.png');
  });

  it('puts white artwork on a dark footer', async () => {
    expect(await footerLogo(both, '#000000', fetchBytes)).toBe('https://cdn/white.png');
    expect(await footerLogo(both, '#1a1a2e', fetchBytes)).toBe('https://cdn/white.png');
  });

  it('falls back to the slot that should fit when nothing can be measured', async () => {
    const unreadable = () => Promise.reject(new Error('down'));
    expect(await footerLogo({ light: 'https://cdn/a.png', dark: 'https://cdn/b.png' }, '#ffffff', unreadable)).toBe('https://cdn/b.png');
    expect(await footerLogo({ light: 'https://cdn/a.png', dark: 'https://cdn/b.png' }, '#000000', unreadable)).toBe('https://cdn/a.png');
  });

  it('uses the only logo without fetching it, and skips one that will not load', async () => {
    expect(await footerLogo({ light: 'https://cdn/only.png' }, '#ffffff', fetchBytes)).toBe('https://cdn/only.png');
    expect(await footerLogo({ light: 'https://cdn/gone.png', dark: 'https://cdn/white.png' }, '#ffffff', fetchBytes)).toBe('https://cdn/white.png');
    expect(await footerLogo(null, '#ffffff', fetchBytes)).toBeNull();
  });
});
