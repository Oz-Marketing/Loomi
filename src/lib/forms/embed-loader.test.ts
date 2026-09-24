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
  /** Extra attributes on the embed's <script> (e.g. `data-gcl-prefix`). */
  attrs?: Record<string, string>;
}): HTMLIFrameElement | null {
  window.history.replaceState(null, '', options.hostUrl ?? '/tp-value-your-trade.htm');
  document.body.innerHTML = '';

  const holder = document.createElement('div');
  const script = document.createElement('script');
  script.setAttribute('src', options.src ?? `${ORIGIN}/loomi-form.js`);
  if (options.slug !== null) script.setAttribute('data-form', options.slug ?? 'appraisal-form');
  if (options.params) script.setAttribute('data-params', options.params);
  for (const [name, value] of Object.entries(options.attrs ?? {})) script.setAttribute(name, value);
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

/** Paths the tests set cookies on — clearing needs the same path. */
const COOKIE_PATHS = ['/', '/trade'];

function setCookie(cookie: string) {
  document.cookie = cookie;
}

function clearCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim();
    if (!name) continue;
    for (const path of COOKIE_PATHS) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}`;
    }
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
  clearCookies();
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

describe('embed loader — ad click ids', () => {
  // Cookie values below are what gtag.js actually wrote in a live session
  // (Sept 2026) for ?gclid= / ?gbraid= / ?wbraid= landings — see the
  // format notes in embed-loader.ts.
  const AW = '_gcl_aw=GCL.1790219680.Probe_Gclid-001; path=/';
  const AG = '_gcl_ag=2.1.kProbe_Gbraid-002$i1790219695; path=/';
  const GB = '_gcl_gb=GCL.1790219714.Probe_Wbraid-003; path=/';
  const AU = '_gcl_au=1.1.139790349.1790219680; path=/';

  it('forwards gbraid and wbraid from the host URL', () => {
    const iframe = runLoader({ hostUrl: '/trade.htm?gbraid=abc_123&wbraid=wb-456' });
    expect(srcParams(iframe)).toMatchObject({ gbraid: 'abc_123', wbraid: 'wb-456' });
  });

  it('falls back to the gclid Google remembered in _gcl_aw', () => {
    setCookie('_gcl_aw=GCL.1700000000.XYZ; path=/');
    expect(srcParams(runLoader({ hostUrl: '/trade.htm' })).gclid).toBe('XYZ');
  });

  it('reads gbraid from _gcl_ag and wbraid from _gcl_gb, as gtag writes them', () => {
    setCookie(AW);
    setCookie(AG);
    setCookie(GB);
    expect(srcParams(runLoader({ hostUrl: '/trade.htm' }))).toMatchObject({
      gclid: 'Probe_Gclid-001',
      gbraid: 'Probe_Gbraid-002',
      wbraid: 'Probe_Wbraid-003',
    });
  });

  it('lets a click on the URL beat the remembered one', () => {
    setCookie('_gcl_aw=GCL.1700000000.FROM_COOKIE; path=/');
    expect(srcParams(runLoader({ hostUrl: '/trade.htm?gclid=FROM_URL' })).gclid).toBe('FROM_URL');
  });

  it('never pairs a URL click with an older cookie click', () => {
    // A gbraid on the URL is this visit's click; the cookie gclid is an
    // earlier one, and sending both would blur which produced the lead.
    setCookie('_gcl_aw=GCL.1700000000.OLD_GCLID; path=/');
    const params = srcParams(runLoader({ hostUrl: '/trade.htm?gbraid=URL_BRAID' }));
    expect(params.gbraid).toBe('URL_BRAID');
    expect(params.gclid).toBeUndefined();
  });

  it('never treats _gcl_au as a click id', () => {
    setCookie(AU);
    expect(new URL(runLoader({ hostUrl: '/trade.htm' })!.src).search).toBe('?embed=1');
  });

  it('ignores malformed cookies instead of guessing', () => {
    setCookie('_gcl_aw=GCL.notanumber.XYZ; path=/');
    setCookie('_gcl_gb=GCL.1700000000; path=/');
    setCookie('_gcl_ag=3.1.kWRONG_VERSION$i1700000000; path=/');
    const iframe = runLoader({ hostUrl: '/trade.htm' });
    expect(iframe).not.toBeNull();
    expect(new URL(iframe!.src).search).toBe('?embed=1');
  });

  it('rejects cookie ids with characters a click id never has', () => {
    setCookie('_gcl_aw=GCL.1700000000.abc%def; path=/');
    setCookie('_gcl_ag=2.1.k%3Cscript%3E$i1700000000; path=/');
    expect(new URL(runLoader({ hostUrl: '/trade.htm' })!.src).search).toBe('?embed=1');
  });

  it('takes the newest click when the cookie is set on two paths', () => {
    setCookie('_gcl_aw=GCL.1800000000.NEWER; path=/');
    setCookie('_gcl_aw=GCL.1700000000.OLDER; path=/trade');
    // document.cookie lists the /trade copy first; the timestamp decides.
    expect(srcParams(runLoader({ hostUrl: '/trade/value.htm' })).gclid).toBe('NEWER');
  });

  it('reads a custom Conversion Linker prefix from data-gcl-prefix', () => {
    setCookie('_gcl2_aw=GCL.1700000000.CUSTOM; path=/');
    expect(
      srcParams(runLoader({ hostUrl: '/trade.htm', attrs: { 'data-gcl-prefix': '_gcl2' } })).gclid,
    ).toBe('CUSTOM');
    // Not read under the default prefix.
    expect(srcParams(runLoader({ hostUrl: '/trade.htm' })).gclid).toBeUndefined();
  });

  it('falls back to _gcl when data-gcl-prefix is not a plain name', () => {
    setCookie('_gcl_aw=GCL.1700000000.DEFAULT; path=/');
    expect(
      srcParams(runLoader({ hostUrl: '/trade.htm', attrs: { 'data-gcl-prefix': 'a b;c' } })).gclid,
    ).toBe('DEFAULT');
  });

  it('drops an empty or malformed ?gclid= and uses the remembered click', () => {
    setCookie('_gcl_aw=GCL.1700000000.XYZ; path=/');
    expect(srcParams(runLoader({ hostUrl: '/trade.htm?gclid=' })).gclid).toBe('XYZ');
    expect(srcParams(runLoader({ hostUrl: '/trade.htm?gclid=abc%20def' })).gclid).toBe('XYZ');
  });

  it('sends click params lowercase, however the host URL spells them', () => {
    const params = srcParams(runLoader({ hostUrl: '/trade.htm?GCLID=UPPER_OK' }));
    expect(params.gclid).toBe('UPPER_OK');
    expect(params.GCLID).toBeUndefined();
  });

  it('still mounts when the host page blocks cookie access', () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    try {
      const iframe = runLoader({ hostUrl: '/trade.htm?utm_source=google' });
      expect(srcParams(iframe)).toEqual({ embed: '1', utm_source: 'google' });
    } finally {
      // Drop the instance override; Document.prototype's accessor is back.
      delete (document as unknown as { cookie?: string }).cookie;
    }
  });

  it('keeps UTMs and data-params exactly as before alongside a cookie click', () => {
    setCookie('_gcl_aw=GCL.1700000000.XYZ; path=/');
    const params = srcParams(
      runLoader({
        hostUrl: '/trade.htm?utm_source=google&utm_campaign=real-click',
        params: 'utm_campaign=hardcoded&utm_medium=web&meta_vin=1FT123',
      }),
    );
    expect(params).toEqual({
      embed: '1',
      utm_source: 'google',
      utm_campaign: 'real-click',
      gclid: 'XYZ',
      utm_medium: 'web',
      meta_vin: '1FT123',
    });
  });
});

describe('embed loader — host page events', () => {
  it('fires loomi-form-submitted with exactly { slug }', () => {
    // GTM containers on dealer sites listen for this — name and shape are
    // a public contract.
    const received: unknown[] = [];
    const listener = (event: Event) => received.push((event as CustomEvent).detail);
    window.addEventListener('loomi-form-submitted', listener);
    try {
      runLoader({});
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'loomi-form-submitted', slug: 'appraisal-form', submissionId: 'sub_1' },
        }),
      );
      expect(received.length).toBeGreaterThan(0);
      for (const detail of received) expect(detail).toEqual({ slug: 'appraisal-form' });
    } finally {
      window.removeEventListener('loomi-form-submitted', listener);
    }
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
