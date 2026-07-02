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
  const [png] = await renderAdBatch([params]);
  return png;
}

/**
 * Render several ads (e.g. every size of one creative) reusing a single
 * browser — launching Chromium dominates single-render latency, so a batch
 * amortizes it. Renders sequentially on one page; order matches the input.
 */
export async function renderAdBatch(
  items: { html: string; width: number; height: number; scale?: number }[],
): Promise<Buffer[]> {
  if (items.some((it) => !it.html.trim())) throw new Error('Template HTML is empty');

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const out: Buffer[] = [];
    for (const { html, width, height, scale = 2 } of items) {
      await page.setViewport({ width, height, deviceScaleFactor: scale });
      // domcontentloaded + a bounded wait for fonts/images below — networkidle0
      // hangs the whole export when a single image URL never responds (the
      // preview just shows that image broken, so the export should match).
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page
        .evaluate(
          `Promise.race([
            Promise.all([
              document.fonts ? document.fonts.ready : Promise.resolve(),
              ...Array.from(document.images).map((img) =>
                img.complete ? Promise.resolve() : new Promise((res) => { img.onload = img.onerror = res; })),
            ]),
            new Promise((res) => setTimeout(res, 8000)),
          ])`,
        )
        .catch(() => {});
      const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } });
      out.push(Buffer.from(buf));
    }
    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}
