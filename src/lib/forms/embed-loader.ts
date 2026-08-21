/**
 * Source of the auto-resizing iframe loader served at `/loomi-form.js`.
 *
 * Customers paste:
 *   <script src="https://studio.loomilm.com/loomi-form.js" data-form="<slug>"></script>
 *
 * For each <script data-form="…"> on the host page the loader:
 *   1. Injects an iframe pointing at /f/<slug>?embed=1 right after the script
 *   2. Listens for postMessage({type:'loomi-form-resize', slug, height})
 *   3. Resizes the iframe as the form's content changes
 *
 * Multiple forms on one page work — each script tag becomes its own
 * iframe, scoped by slug.
 *
 * Attribution: the iframe is a different origin, so the form can't read
 * the host page's URL for itself. The loader copies campaign params across:
 *
 *   data-params="utm_source=web&meta_vin=1FT…"
 *     Static tagging baked into the embed — the campaign this placement
 *     belongs to, or VDP context for a fixed vehicle.
 *   ?utm_*, ?gclid, ?fbclid, ?msclkid on the HOST page
 *     Copied automatically, and they win over `data-params` — a visitor
 *     who actually clicked a tagged ad is better attribution data than
 *     the placement's hardcoded default.
 *
 * Without that, tagging an embedded form meant hand-writing an <iframe>
 * with the params in its src — which also meant hand-picking a fixed
 * height and living with the dead space when the form didn't fill it.
 *
 * The body is a plain string of ES5 (`var`, no arrow functions) because it
 * runs on whatever browser a dealer's site happens to attract. Backslashes
 * need doubling here: this file's template literal is one level of escaping
 * above the JavaScript that ships.
 */
export function buildLoaderScript(origin: string): string {
  return `(function(){
  'use strict';
  var ORIGIN = ${JSON.stringify(origin)};

  // Params copied off the host page URL. Campaign tagging and ad-click
  // ids only — never the whole query string, which on a dealer site
  // carries session junk and sometimes PII.
  var FORWARD = /^(utm_[a-z]+|gclid|fbclid|msclkid)$/i;

  function parseQuery(search){
    var out = [];
    var raw = String(search || '').replace(/^[?&]+/, '');
    if (!raw) return out;
    var pairs = raw.split('&');
    for (var i = 0; i < pairs.length; i++){
      if (!pairs[i]) continue;
      var eq = pairs[i].indexOf('=');
      var key = eq === -1 ? pairs[i] : pairs[i].slice(0, eq);
      var value = eq === -1 ? '' : pairs[i].slice(eq + 1);
      if (!key) continue;
      try {
        out.push([
          decodeURIComponent(key.replace(/\\+/g, ' ')),
          decodeURIComponent(value.replace(/\\+/g, ' '))
        ]);
      } catch (e) {
        // A stray '%' makes decodeURIComponent throw. Skip the pair
        // rather than losing every param after it.
      }
    }
    return out;
  }

  function buildSrc(scriptEl, slug){
    var seen = {};
    var parts = [];
    function add(key, value){
      var lower = key.toLowerCase();
      if (lower === 'embed') return;      // we always set this ourselves
      if (seen[lower]) return;
      seen[lower] = true;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    }

    // Host-page params go first so they win the dedupe against data-params.
    var host = parseQuery(window.location.search);
    for (var i = 0; i < host.length; i++){
      if (FORWARD.test(host[i][0])) add(host[i][0], host[i][1]);
    }
    var declared = parseQuery(scriptEl.getAttribute('data-params'));
    for (var j = 0; j < declared.length; j++) add(declared[j][0], declared[j][1]);

    return ORIGIN + '/f/' + encodeURIComponent(slug) + '?embed=1' +
      (parts.length ? '&' + parts.join('&') : '');
  }

  function mount(scriptEl){
    var slug = scriptEl.getAttribute('data-form');
    if (!slug) return;
    if (scriptEl.__loomiMounted) return;
    scriptEl.__loomiMounted = true;

    var iframe = document.createElement('iframe');
    iframe.src = buildSrc(scriptEl, slug);
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
