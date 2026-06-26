import { launchBrowser } from '@/lib/render/chromium';

/**
 * Render an ad template's HTML to a PNG at exact pixel dimensions.
 *
 * Unlike the email screenshot (auto-height, trimmed), ads are fixed-size: we set
 * the viewport to the ad's dimensions, wait for fonts + images, and capture a
 * clip of exactly width×height at `scale`× density (retina). The HTML comes from
 * the same pure template function used for the live preview, so the output is
 * pixel-identical to what the user previewed.
 */
export async function renderAd(params: {
  html: string;
  width: number;
  height: number;
  /** Pixel density multiplier (2 = retina). */
  scale?: number;
}): Promise<Buffer> {
  const { html, width, height, scale = 2 } = params;
  if (!html.trim()) throw new Error('Template HTML is empty');

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: ['networkidle0', 'domcontentloaded'], timeout: 20000 });
    // Let webfonts settle so text metrics match the preview.
    await page.evaluate('document.fonts && document.fonts.ready').catch(() => {});
    const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } });
    return Buffer.from(buf);
  } finally {
    await browser.close().catch(() => {});
  }
}
