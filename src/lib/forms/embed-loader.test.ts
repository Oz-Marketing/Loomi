// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { buildLoaderScript } from './embed-loader';

const ORIGIN = 'https://studio.loomilm.com';

/**
 * Run the real loader against a jsdom page, the way a dealer's site would:
 * set the host URL, drop in the <script data-form> tag, execute.
 * Returns the iframe the loader injected (or null when it declined to).
 */
function runLoader(options: {
  hostUrl?: string;
  slug?: string | null;
  params?: string | null;
  src?: string;
}): HTMLIFrameElement | null {
  window.history.replaceState(null, '', options.hostUrl ?? '/tp-value-your-trade.htm');
  document.body.innerHTML = '';

  const holder = document.createElement('div');
  const script = document.createElement('script');
  script.setAttribute('src', options.src ?? `${ORIGIN}/loomi-form.js`);
  if (options.slug !== null) script.setAttribute('data-form', options.slug ?? 'appraisal-form');
  if (options.params) script.setAttribute('data-params', options.params);
  holder.appendChild(script);
  document.body.appendChild(holder);

  // eslint-disable-next-line no-eval
  window.eval(buildLoaderScript(ORIGIN));
  return document.querySelector('iframe[data-loomi-form]');
}

/** Query params off the injected iframe, as a plain object. */
function srcParams(iframe: HTMLIFrameElement | null): Record<string, string> {
  const url = new URL(iframe!.src);
  return Object.fromEntries(url.searchParams.entries());
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('embed loader — mounting', () => {
  it('injects an iframe for the form right after the script tag', () => {
    const iframe = runLoader({});
    expect(iframe).not.toBeNull();
    expect(new URL(iframe!.src).pathname).toBe('/f/appraisal-form');
    expect(srcParams(iframe).embed).toBe('1');
  });

  it('ignores a data-form script that is not this loader', () => {
    expect(runLoader({ src: 'https://example.com/other-widget.js' })).toBeNull();
  });

  it('ignores a script with no slug', () => {
    expect(runLoader({ slug: null })).toBeNull();
  });

  it('starts at zero height — the resize message is what reveals it', () => {
    // Regression guard: the iframe must not carry an arbitrary fixed
    // height, which is what leaves dead space under a short form.
    expect(runLoader({})!.style.height).toBe('0px');
  });
});

describe('embed loader — campaign attribution', () => {
  it('carries static data-params onto the iframe', () => {
    const iframe = runLoader({
      params: 'utm_source=landing-page&utm_medium=web&utm_campaign=yfm-trade-1000-aug-2026',
    });
    expect(srcParams(iframe)).toMatchObject({
      embed: '1',
      utm_source: 'landing-page',
      utm_medium: 'web',
      utm_campaign: 'yfm-trade-1000-aug-2026',
    });
  });

  it('forwards campaign params from the host page URL', () => {
    const iframe = runLoader({
      hostUrl: '/trade.htm?utm_source=google&utm_campaign=aug-trade&gclid=abc123',
    });
    expect(srcParams(iframe)).toMatchObject({
      utm_source: 'google',
      utm_campaign: 'aug-trade',
      gclid: 'abc123',
    });
  });

  it('lets the visitor real click source win over the placement default', () => {
    const iframe = runLoader({
      hostUrl: '/trade.htm?utm_campaign=real-click',
      params: 'utm_campaign=hardcoded&utm_medium=web',
    });
    const params = srcParams(iframe);
    expect(params.utm_campaign).toBe('real-click');
    // The rest of the static tagging still applies.
    expect(params.utm_medium).toBe('web');
  });

  it('leaves non-campaign host params behind', () => {
    // A dealer site's query string carries session junk we have no
    // business copying into a lead record.
    const iframe = runLoader({
      hostUrl: '/trade.htm?utm_source=google&sessionId=abc&email=someone@example.com',
    });
    const params = srcParams(iframe);
    expect(params.utm_source).toBe('google');
    expect(params.sessionId).toBeUndefined();
    expect(params.email).toBeUndefined();
  });

  it('never lets a param override embed=1', () => {
    const iframe = runLoader({ params: 'embed=0' });
    expect(srcParams(iframe).embed).toBe('1');
  });

  it('round-trips values that need encoding', () => {
    const iframe = runLoader({ params: 'utm_campaign=summer%20sale%20%26%20more' });
    expect(srcParams(iframe).utm_campaign).toBe('summer sale & more');
  });

  it('survives a malformed percent-escape without losing later params', () => {
    const iframe = runLoader({ params: 'utm_source=100%off&utm_campaign=aug' });
    expect(srcParams(iframe).utm_campaign).toBe('aug');
  });

  it('sends only embed=1 when there is nothing to attribute', () => {
    const iframe = runLoader({ hostUrl: '/trade.htm' });
    expect(new URL(iframe!.src).search).toBe('?embed=1');
  });
});

describe('embed loader — resize messages', () => {
  it('sizes the iframe to the height the form reports', () => {
    const iframe = runLoader({})!;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'loomi-form-resize', slug: 'appraisal-form', height: 814 },
      }),
    );
    // +4 guards against a sub-pixel rounding scrollbar.
    expect(iframe.style.height).toBe('818px');
  });

  it('ignores a resize aimed at a different form on the same page', () => {
    const iframe = runLoader({})!;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'loomi-form-resize', slug: 'some-other-form', height: 3000 },
      }),
    );
    expect(iframe.style.height).toBe('0px');
  });

  it('ignores a message with a non-numeric height', () => {
    const iframe = runLoader({})!;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'loomi-form-resize', slug: 'appraisal-form', height: '900px' },
      }),
    );
    expect(iframe.style.height).toBe('0px');
  });
});
