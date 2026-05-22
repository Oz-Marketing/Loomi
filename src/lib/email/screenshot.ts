import puppeteerCore, { type Browser, type Page } from 'puppeteer-core';
import sharp from 'sharp';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Launch a headless Chromium browser.
 *
 * In production (serverless / VPS without Chrome), uses @sparticuz/chromium
 * which bundles a lightweight Chromium binary.
 * In development, uses the locally-installed Chromium from the `puppeteer` package.
 */
async function launchBrowser(): Promise<Browser> {
  if (IS_PRODUCTION) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return puppeteerCore.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    }) as Promise<Browser>;
  }

  // Development: use full puppeteer's bundled Chromium
  const puppeteer = (await import('puppeteer')).default;
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  }) as unknown as Promise<Browser>;
}

/**
 * Extract an iframe src URL from wrapper HTML.
 * Some preview APIs return a small wrapper page that loads the actual email
 * content inside an <iframe>. Puppeteer can't load cross-origin iframes when
 * the page is loaded via setContent (about:blank origin), so we need to
 * navigate directly to the iframe src instead.
 */
function extractIframeSrc(html: string): string | null {
  const match = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  return match?.[1] ?? null;
}

/**
 * Load the email content into Puppeteer. If the HTML is a wrapper page with
 * an iframe, navigate directly to the iframe src. Otherwise, set the HTML
 * content directly.
 */
async function loadEmailContent(page: Page, html: string): Promise<void> {
  const iframeSrc = extractIframeSrc(html);

  if (iframeSrc) {
    console.log(`[screenshot-render] Wrapper HTML detected with iframe src — navigating directly to iframe URL`);
    try {
      await page.goto(iframeSrc, {
        waitUntil: ['networkidle0', 'domcontentloaded'],
        timeout: 20000,
      });
      return;
    } catch (err) {
      console.warn(
        `[screenshot-render] Failed to navigate to iframe src: ${err instanceof Error ? err.message : err}` +
        ` — falling back to setContent`,
      );
    }
  }

  await page.setContent(html, {
    waitUntil: ['networkidle0', 'domcontentloaded'],
    timeout: 15000,
  });
}

export async function renderCampaignScreenshotFromHtml(params: {
  html: string;
  filename?: string;
}): Promise<{ image: Buffer; contentType: string; filename: string }> {
  const { html, filename = 'campaign-screenshot.png' } = params;

  if (!html.trim()) {
    throw new Error('Preview HTML is empty');
  }

  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
    await loadEmailContent(page, html);

    // Prevent vh/percentage-based layouts from stretching; measure true content height.
    // Email CSS often sets `html, body { height: 100% !important }` which constrains
    // scrollHeight to the viewport. Override height/overflow on html, body, AND common
    // wrapper elements (direct children of body, tables, etc.) so nested containers
    // with overflow:hidden or fixed heights don't clip email content.
    await page.evaluate(`(function () {
      var s = document.createElement('style');
      s.textContent = [
        'html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; }',
        'body > *, body > * > * { max-height: none !important; overflow: visible !important; }',
        'table, tr, td, th { overflow: visible !important; }',
      ].join('\\n');
      document.head.appendChild(s);
      document.documentElement.style.setProperty('height', 'auto', 'important');
      document.body.style.setProperty('height', 'auto', 'important');
      document.body.style.setProperty('overflow', 'visible', 'important');
    })()`);

    // Wait for images to load and track failures
    const imgStats = await page.evaluate(`new Promise(function (resolve) {
      var imgs = Array.from(document.querySelectorAll('img'));
      if (imgs.length === 0) { resolve({ total: 0, loaded: 0, failed: 0 }); return; }
      var loaded = 0;
      var failed = 0;
      var total = imgs.length;
      function check() {
        if ((loaded + failed) >= total) resolve({ total: total, loaded: loaded, failed: failed });
      }
      imgs.forEach(function (img) {
        if (img.complete) {
          if (img.naturalWidth > 0) loaded++; else failed++;
          check();
        } else {
          img.addEventListener('load', function () { loaded++; check(); });
          img.addEventListener('error', function () { failed++; check(); });
        }
      });
      setTimeout(function () { resolve({ total: total, loaded: loaded, failed: failed }); }, 5000);
    })`) as { total: number; loaded: number; failed: number };

    if (imgStats.failed > 0) {
      console.warn(
        `[screenshot-render] ${imgStats.failed}/${imgStats.total} images failed to load`,
      );
    }

    await new Promise((r) => setTimeout(r, 300));

    // Measure true content height using multiple methods
    const contentHeight = await page.evaluate(`(function () {
      var docH = document.documentElement.scrollHeight;
      var bodyH = document.body.scrollHeight;
      var bodyOH = document.body.offsetHeight;
      var maxChild = 0;
      var children = document.body.children;
      for (var i = 0; i < children.length; i++) {
        var rect = children[i].getBoundingClientRect();
        var bottom = rect.top + rect.height;
        if (bottom > maxChild) maxChild = bottom;
      }
      return Math.max(docH, bodyH, bodyOH, Math.ceil(maxChild));
    })()`) as number;

    // Resize viewport to match actual content height before capturing
    const finalHeight = Math.max(contentHeight, 800);
    await page.setViewport({
      width: 1280,
      height: finalHeight,
      deviceScaleFactor: 2,
    });

    // Brief wait for re-layout after viewport resize
    await new Promise((r) => setTimeout(r, 200));

    const rawScreenshot = await page.screenshot({
      type: 'png',
      fullPage: true,
    });

    await browser.close();
    browser = null;

    const imgBuffer = Buffer.from(rawScreenshot);
    const { data: rawPixels, info } = await sharp(imgBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    const WHITE_THRESHOLD = 250;

    // Scan from bottom to find the last row with non-white content
    let lastContentRow = height - 1;
    for (let y = height - 1; y >= 0; y--) {
      let rowHasContent = false;
      for (let x = 0; x < width; x += 4) {
        const offset = (y * width + x) * channels;
        const r = rawPixels[offset];
        const g = rawPixels[offset + 1];
        const b = rawPixels[offset + 2];
        if (r < WHITE_THRESHOLD || g < WHITE_THRESHOLD || b < WHITE_THRESHOLD) {
          rowHasContent = true;
          break;
        }
      }
      if (rowHasContent) {
        lastContentRow = y;
        break;
      }
    }

    // Safety: never trim more than 40% of the image. If the trim would remove
    // more, it likely means images failed to load and the email body appears as
    // white space — return the full screenshot instead of a cropped header.
    const trimRatio = 1 - (lastContentRow + 1) / height;
    const MAX_TRIM_RATIO = 0.4;

    let cropHeight: number;
    if (trimRatio > MAX_TRIM_RATIO) {
      console.warn(
        `[screenshot-render] Trim would remove ${Math.round(trimRatio * 100)}% of the image` +
        ` (lastContentRow=${lastContentRow}, height=${height})` +
        ` — skipping trim to preserve full email content`,
      );
      cropHeight = height;
    } else {
      cropHeight = Math.min(lastContentRow + 33, height);
    }

    const trimmed = await sharp(imgBuffer)
      .extract({ left: 0, top: 0, width, height: cropHeight })
      .toBuffer();

    return {
      image: trimmed,
      contentType: 'image/png',
      filename,
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore close errors
      }
    }
  }
}
