import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { footerLogo, opaqueLuminance } from './logo';

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

describe('footerLogo', () => {
  const files: Record<string, Promise<Buffer>> = {
    'https://cdn/white.png': png('#ffffff'),
    'https://cdn/navy.png': png('#0b1f4b'),
  };
  const fetchBytes = (url: string) => files[url] ?? Promise.reject(new Error('404'));

  it('takes the dark artwork, whatever slot it was uploaded to', async () => {
    // Young Chev: "light" holds the white logo, "dark" the navy one.
    expect(await footerLogo({ light: 'https://cdn/white.png', dark: 'https://cdn/navy.png' }, fetchBytes)).toBe('https://cdn/navy.png');
    // The other reading of the labels.
    expect(await footerLogo({ light: 'https://cdn/navy.png', dark: 'https://cdn/white.png' }, fetchBytes)).toBe('https://cdn/navy.png');
  });

  it('uses the only logo without fetching it, and skips one that will not load', async () => {
    expect(await footerLogo({ light: 'https://cdn/only.png' }, fetchBytes)).toBe('https://cdn/only.png');
    expect(await footerLogo({ light: 'https://cdn/gone.png', dark: 'https://cdn/white.png' }, fetchBytes)).toBe('https://cdn/white.png');
    expect(await footerLogo(null, fetchBytes)).toBeNull();
  });
});
