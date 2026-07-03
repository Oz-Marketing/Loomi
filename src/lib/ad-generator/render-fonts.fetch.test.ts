import { describe, it, expect, vi, afterEach } from 'vitest';
import { embeddedFontFaceCss } from './render-fonts';

/**
 * Regression: a font URL whose prefix no longer matches S3_PUBLIC_URL_PREFIX
 * (e.g. after a storage migration) must still embed via a plain server-side
 * fetch, instead of silently dropping to an empty @font-face — which left brand
 * fonts unrendered in the editor because the browser's cross-origin URL-based
 * @font-face is CORS-blocked in the preview iframe.
 */
describe('embeddedFontFaceCss fetch fallback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('embeds a font by plain URL when the S3 key cannot be resolved', async () => {
    // A URL that s3KeyFromPublicUrl won't recognize (no matching prefix) → the
    // code path falls through to fetch().
    const url = 'https://old-bucket.example.com/fonts/genesis-700.woff2';
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => bytes.buffer,
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const css = await embeddedFontFaceCss([{ family: 'Genesis Sans Head', weight: '700', url }]);

    expect(fetchSpy).toHaveBeenCalledWith(url);
    expect(css).toContain('@font-face');
    expect(css).toContain('font-family:"Genesis Sans Head"');
    expect(css).toContain('font-weight:700');
    expect(css).toContain(`data:font/woff2;base64,${Buffer.from(bytes).toString('base64')}`);
  });

  it('skips a face when neither S3 nor fetch can retrieve it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })),
    );
    const css = await embeddedFontFaceCss([
      { family: 'Missing', url: 'https://old-bucket.example.com/x.woff2' },
    ]);
    expect(css).toBe('');
  });
});
