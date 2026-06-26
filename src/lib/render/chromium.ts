import puppeteerCore, { type Browser } from 'puppeteer-core';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Launch a headless Chromium browser.
 *
 * Production (droplet / serverless): @sparticuz/chromium's bundled binary.
 * Development: the local Chromium from the full `puppeteer` package.
 *
 * Mirrors the launcher in lib/email/screenshot.ts; shared here so the ad-studio
 * renderer and email screenshots use one code path.
 */
export async function launchBrowser(): Promise<Browser> {
  if (IS_PRODUCTION) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return puppeteerCore.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    }) as Promise<Browser>;
  }

  const puppeteer = (await import('puppeteer')).default;
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  }) as unknown as Promise<Browser>;
}
