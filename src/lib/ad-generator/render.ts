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
export interface RenderAdItem {
  html: string;
  width: number;
  height: number;
  /** Pixel density multiplier (2 = retina). */
  scale?: number;
  /** Capture with an alpha channel and no page background — used for the plates
   *  the MP4 compositor stacks over a clip. */
  transparent?: boolean;
}

export async function renderAd(params: RenderAdItem): Promise<Buffer> {
  const [png] = await renderAdBatch([params]);
  return png;
}

/**
 * Render several ads (e.g. every size of one creative) reusing a single
 * browser — launching Chromium dominates single-render latency, so a batch
 * amortizes it. Renders sequentially on one page; order matches the input.
 */
export async function renderAdBatch(items: RenderAdItem[]): Promise<Buffer[]> {
  if (items.some((it) => !it.html.trim())) throw new Error('Template HTML is empty');

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const out: Buffer[] = [];
    for (const { html, width, height, scale = 2, transparent = false } of items) {
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
      // A motion layer is a real <video> in the markup (so the builder and the
      // browser preview play it). For a STILL we can't screenshot whichever frame
      // the decoder happens to be on — that would make the same ad export a
      // different PNG each time, and the thumbnail Meta gets wouldn't match the
      // frame the MP4 opens on. So each clip is paused and seeked to its
      // `trimStart`, and only then captured.
      await page.evaluate(FREEZE_VIDEOS).catch(() => {});
      // Force a final fill-to-width pass now that fonts are loaded, so any pinned-
      // width text is sized against real glyph metrics before we capture.
      await page.evaluate('window.__fitText && window.__fitText()').catch(() => {});
      const buf = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width, height },
        ...(transparent ? { omitBackground: true } : {}),
      });
      out.push(Buffer.from(buf));
    }
    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Pause every motion layer on its poster frame (see the call site).
 *
 * Injected as source rather than a function reference so it stays inspectable
 * next to the wait above. Bounded: a clip that never loads resolves anyway, for
 * the same reason the image wait is bounded — one dead URL must not hang an
 * export that would otherwise be fine (it just renders that layer empty, exactly
 * as the preview showed it).
 */
const FREEZE_VIDEOS = `Promise.race([
  Promise.all(Array.from(document.querySelectorAll('video[data-motion]')).map(function (v) {
    return new Promise(function (done) {
      var at = parseFloat(v.getAttribute('data-still-at') || '0') || 0;
      function seek() {
        v.pause();
        var target = at;
        if (isFinite(v.duration) && v.duration > 0) target = Math.min(at, Math.max(0, v.duration - 0.05));
        if (Math.abs(v.currentTime - target) < 0.02) return requestAnimationFrame(function(){ done(); });
        v.addEventListener('seeked', function () { requestAnimationFrame(function(){ done(); }); }, { once: true });
        try { v.currentTime = target; } catch (e) { done(); }
      }
      if (v.readyState >= 2) return seek();
      v.addEventListener('loadeddata', seek, { once: true });
      v.addEventListener('error', function () { done(); }, { once: true });
    });
  })),
  new Promise(function (res) { setTimeout(res, 10000); }),
])`;
