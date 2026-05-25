import { NextRequest, NextResponse } from 'next/server';

/**
 * Auto-resizing iframe loader.
 *
 * Served at `/loomi-form.js`. Customers paste:
 *   <script src="https://studio.loomilm.com/loomi-form.js" data-form="<slug>"></script>
 *
 * For each <script data-form="…"> on the host page we:
 *   1. Inject an iframe pointing at /f/<slug>?embed=1 directly after the script
 *   2. Listen for postMessage({type:'loomi-form-resize', slug, height}) from the iframe
 *   3. Resize the iframe height as the form's content changes
 *
 * Multiple forms on one page work — each script tag becomes its own
 * iframe, scoped by slug.
 */

// Cache aggressively — the loader is tiny and version-independent.
// 1 hour browser cache + 1 day CDN cache. Bump the source if you change the contract.
const CACHE_HEADERS = {
  'Content-Type': 'application/javascript; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, s-maxage=86400',
  // Permissive CORS — the script will be loaded from arbitrary customer
  // origins. The actual form submit endpoint has its own CORS headers.
  'Access-Control-Allow-Origin': '*',
};

function buildLoaderScript(origin: string): string {
  // Embedded in a string — avoid template-literal interpolation conflicts.
  // The `__ORIGIN__` placeholder gets replaced at request time.
  return `(function(){
  'use strict';
  var ORIGIN = ${JSON.stringify(origin)};

  function mount(scriptEl){
    var slug = scriptEl.getAttribute('data-form');
    if (!slug) return;
    if (scriptEl.__loomiMounted) return;
    scriptEl.__loomiMounted = true;

    var iframe = document.createElement('iframe');
    iframe.src = ORIGIN + '/f/' + encodeURIComponent(slug) + '?embed=1';
    iframe.setAttribute('data-loomi-form', slug);
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('frameborder', '0');
    iframe.style.cssText = 'border:0;display:block;width:100%;background:transparent;height:0;transition:height 120ms ease;';
    iframe.allowTransparency = true;

    scriptEl.parentNode.insertBefore(iframe, scriptEl.nextSibling);
  }

  function init(){
    var scripts = document.querySelectorAll('script[data-form]');
    for (var i = 0; i < scripts.length; i++){
      // Only mount scripts pointing at this loader — leaves other
      // data-form-tagged scripts alone (defensive against collisions).
      var src = scripts[i].getAttribute('src') || '';
      if (src.indexOf('/loomi-form.js') === -1) continue;
      mount(scripts[i]);
    }
  }

  window.addEventListener('message', function(event){
    var data = event && event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'loomi-form-resize' && data.slug && typeof data.height === 'number'){
      var iframes = document.querySelectorAll('iframe[data-loomi-form="' + cssEscape(data.slug) + '"]');
      for (var i = 0; i < iframes.length; i++){
        iframes[i].style.height = (data.height + 4) + 'px';
      }
    } else if (data.type === 'loomi-form-redirect' && data.url){
      // The iframe will navigate itself; we mirror the redirect to the
      // top-level page so users actually leave the host site.
      try { window.top.location.href = data.url; } catch(e){}
    } else if (data.type === 'loomi-form-submitted' && data.slug){
      // Fire a custom event the host page can hook into for analytics.
      try {
        window.dispatchEvent(new CustomEvent('loomi-form-submitted', { detail: { slug: data.slug } }));
      } catch(e){}
    }
  });

  // Minimal CSS.escape polyfill — older browsers + some embedded
  // contexts don't expose it. Only needs to handle a slug, which is
  // [a-z0-9-]+ by construction, but be defensive.
  function cssEscape(s){
    if (window.CSS && window.CSS.escape) return window.CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
}

function origin(req: NextRequest): string {
  // Prefer the public env var (canonical production host) over the
  // request host so the script always points back at studio.loomilm.com
  // even when served via a CDN.
  const envOrigin = process.env.NEXT_PUBLIC_APP_URL;
  if (envOrigin) return envOrigin.replace(/\/+$/, '');
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('host') || 'studio.loomilm.com';
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  return new NextResponse(buildLoaderScript(origin(req)), { headers: CACHE_HEADERS });
}
