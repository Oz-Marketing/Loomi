import type { Browser, Page } from 'puppeteer-core';
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
 *
 * Returns every PNG at once, so peak memory is the sum of all of them. That is
 * fine for a handful of plates, but NOT for "every size of this ad" — see
 * `openAdRenderSession` for the streaming form the ZIP export uses.
 */
export async function renderAdBatch(items: RenderAdItem[]): Promise<Buffer[]> {
  assertRenderable(items);

  const session = await openAdRenderSession();
  try {
    const out: Buffer[] = [];
    for (const item of items) out.push(await session.render(item));
    return out;
  } finally {
    await session.close();
  }
}

/**
 * A held-open renderer: one Chromium, one page, one PNG at a time.
 *
 * `renderAdBatch` returns an array, which means the caller holds every PNG until
 * the last one is done. The ZIP export can't afford that — 22 retina sizes of a
 * photographic ad is a few hundred MB of Buffers, and it used to be copied twice
 * more by the zip step, which put the production process over pm2's
 * `max_memory_restart` and killed it mid-request. nginx reported that as a 502
 * ("upstream prematurely closed connection"), so the download failed in a way the
 * route could not even report on.
 *
 * A session lets the caller pull renders as an archive writer asks for them and
 * drop each buffer once it's written, holding one PNG instead of all of them.
 * The caller MUST `close()` — including on the error and client-abort paths, or
 * the Chromium process leaks.
 */
export interface AdRenderSession {
  render(item: RenderAdItem): Promise<Buffer>;
  /**
   * Capture straight to a file, so the PNG never becomes a Buffer here.
   *
   * Worth its awkwardness: `page.screenshot()` returning bytes costs 60-80 MB of
   * transient CDP buffers for a 17 MB retina PNG, and those pile up faster than
   * V8 reclaims them (measured: 79 MB, then 145, then 213 over three shots of the
   * same size) because external ArrayBuffer pressure barely moves the heap-based
   * GC trigger. Letting Chromium's client write the file instead holds that flat
   * at roughly zero growth per shot, and the caller streams the file back in
   * 64 KB chunks rather than holding it whole.
   */
  renderToFile(item: RenderAdItem, path: `${string}.png`): Promise<void>;
  close(): Promise<void>;
}

export async function openAdRenderSession(): Promise<AdRenderSession> {
  const browser: Browser = await launchBrowser();
  let page: Page;
  try {
    page = await browser.newPage();
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }

  // One page means renders must not overlap. Callers are sequential today (an
  // archive writer pulls entries in order), but the queue makes that a property
  // of this session rather than an assumption about every caller.
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;

  /** Run one capture at a time on the shared page; see `queue` above. */
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = queue.then(() => {
      if (closed) throw new Error('Render session is closed');
      return job();
    });
    // Keep the chain alive after a rejection so one bad size doesn't wedge the
    // queue for the rest (the caller still sees its own rejection).
    queue = next.catch(() => {});
    return next;
  }

  return {
    render(item: RenderAdItem): Promise<Buffer> {
      assertRenderable([item]);
      return enqueue(() => renderOnPage(page, item));
    },
    renderToFile(item: RenderAdItem, path: `${string}.png`): Promise<void> {
      assertRenderable([item]);
      return enqueue(() => renderOnPage(page, item, path).then(() => undefined));
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await browser.close().catch(() => {});
    },
  };
}

function assertRenderable(items: RenderAdItem[]): void {
  if (items.some((it) => !it.html.trim())) throw new Error('Template HTML is empty');
}

/**
 * Capture one ad on an already-open page.
 *
 * With `path`, Chromium's client writes the PNG and nothing large is allocated
 * here (see `renderToFile`); the returned Buffer is empty in that case.
 */
async function renderOnPage(
  page: Page,
  { html, width, height, scale = 2, transparent = false }: RenderAdItem,
  path?: `${string}.png`,
): Promise<Buffer> {
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
  const shot = {
    type: 'png' as const,
    clip: { x: 0, y: 0, width, height },
    ...(transparent ? { omitBackground: true } : {}),
  };
  if (path) {
    await page.screenshot({ ...shot, path });
    return Buffer.alloc(0);
  }
  return Buffer.from(await page.screenshot(shot));
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
