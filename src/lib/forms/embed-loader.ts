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
 *   ?utm_*, ?gclid, ?gbraid, ?wbraid, ?fbclid, ?msclkid on the HOST page
 *     Copied automatically, and they win over `data-params` — a visitor
 *     who actually clicked a tagged ad is better attribution data than
 *     the placement's hardcoded default.
 *   Google's `_gcl_*` cookies on the HOST page
 *     When the host URL carries no Google click, the loader falls back to
 *     the one Google's conversion linker remembered — a visitor who landed
 *     on the homepage from an ad and browsed to the trade-in page has no
 *     gclid in the URL any more, but still has it in `_gcl_aw`. A site
 *     whose Conversion Linker uses a custom cookie prefix declares it with
 *     `data-gcl-prefix="_gcl2"` (Google's default is `_gcl`).
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
  var FORWARD = /^(utm_[a-z]+|gclid|gbraid|wbraid|fbclid|msclkid)$/i;
  var CLICK_PARAM = /^(gclid|gbraid|wbraid|fbclid|msclkid)$/i;
  // Google's three ids are alternatives for one click (gbraid / wbraid
  // stand in for a gclid on some iOS traffic).
  var GOOGLE_CLICK = /^(gclid|gbraid|wbraid)$/i;
  // The server's rule for a click id (it re-checks; this just keeps junk
  // off the iframe URL). gtag's own rule, [\\w-]+, fits inside it.
  var CLICK_ID = /^[\\w.-]{1,256}$/;

  // Google's conversion linker remembers the last ad click in first-party
  // cookies. Google doesn't document the formats; these are read off
  // gtag.js and a live session (Sept 2026):
  //   <prefix>_aw  GCL.<unix seconds>.<gclid>
  //   <prefix>_gb  GCL.<unix seconds>.<wbraid>    (wbraid — not gbraid)
  //   <prefix>_ag  2.1.k<gbraid>$i<unix seconds>  ('$'-joined, each field
  //                                                URI-encoded)
  // <prefix>_au is the linker's visitor id, not a click — never read.
  // Anything that doesn't parse is ignored rather than guessed at.
  // Every value of each named cookie — a cookie can be set twice (a
  // subdomain copy and a parent-domain one). Only the names asked for, so
  // an odd host cookie name can't reach the lookup object.
  function readCookies(names){
    var found = {};
    for (var n = 0; n < names.length; n++) found[names[n]] = [];
    var raw;
    try { raw = String(document.cookie || ''); } catch (e) { return found; }
    var pairs = raw.split(';');
    for (var i = 0; i < pairs.length; i++){
      var pair = pairs[i].replace(/^\\s+|\\s+$/g, '');
      var eq = pair.indexOf('=');
      if (eq <= 0) continue;
      var name = pair.slice(0, eq);
      for (var m = 0; m < names.length; m++){
        if (names[m] === name) found[name].push(pair.slice(eq + 1));
      }
    }
    return found;
  }

  function parseGclCookie(value){
    var bits = String(value).split('.');
    if (bits.length < 3 || (bits[0] !== 'GCL' && bits[0] !== '1')) return null;
    if (!/^\\d+$/.test(bits[1]) || !CLICK_ID.test(bits[2])) return null;
    return { id: bits[2], ts: Number(bits[1]) };
  }

  function parseStructuredGclCookie(value){
    var bits = String(value).split('.');
    if (bits.length < 3 || bits[0] !== '2') return null;
    var fields = bits.slice(2).join('.').split('$');
    var id = null, ts = 0;
    for (var i = 0; i < fields.length; i++){
      var field;
      try { field = decodeURIComponent(fields[i]); } catch (e) { continue; }
      var tag = field.charAt(0), rest = field.slice(1);
      if (tag === 'k') id = rest;
      else if (tag === 'i' && /^\\d+$/.test(rest)) ts = Number(rest);
    }
    return id && CLICK_ID.test(id) ? { id: id, ts: ts } : null;
  }

  // The newest click that parses.
  function newestClick(values, parse){
    var best = null;
    for (var i = 0; values && i < values.length; i++){
      var click = parse(values[i]);
      if (click && (!best || click.ts > best.ts)) best = click;
    }
    return best ? best.id : null;
  }

  function rememberedGoogleClick(prefix){
    var aw = prefix + '_aw', ag = prefix + '_ag', gb = prefix + '_gb';
    var jar = readCookies([aw, ag, gb]);
    var out = [];
    var gclid = newestClick(jar[aw], parseGclCookie);
    var gbraid = newestClick(jar[ag], parseStructuredGclCookie);
    var wbraid = newestClick(jar[gb], parseGclCookie);
    if (gclid) out.push(['gclid', gclid]);
    if (gbraid) out.push(['gbraid', gbraid]);
    if (wbraid) out.push(['wbraid', wbraid]);
    return out;
  }

  // Word characters only, as gtag itself requires; anything else means
  // the default.
  function gclPrefix(scriptEl){
    var prefix = scriptEl.getAttribute('data-gcl-prefix');
    return prefix && /^\\w{1,64}$/.test(prefix) ? prefix : '_gcl';
  }

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
    var hostHasGoogleClick = false;
    for (var i = 0; i < host.length; i++){
      var key = host[i][0], value = host[i][1];
      if (!FORWARD.test(key)) continue;
      if (CLICK_PARAM.test(key)){
        // An empty or malformed ?gclid= is no click — drop it rather than
        // let it block the cookie one.
        if (!CLICK_ID.test(value)) continue;
        // The form reads them lowercase, which is how every network sends them.
        key = key.toLowerCase();
        if (GOOGLE_CLICK.test(key)) hostHasGoogleClick = true;
      }
      add(key, value);
    }

    // No Google click on this URL: use the one the conversion linker
    // remembered. Never both — a click on the URL is the fresher one, and
    // mixing a URL gbraid with an old cookie gclid would blur which click
    // produced the lead.
    if (!hostHasGoogleClick){
      var remembered = [];
      try { remembered = rememberedGoogleClick(gclPrefix(scriptEl)); } catch (e) {}
      for (var k = 0; k < remembered.length; k++) add(remembered[k][0], remembered[k][1]);
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
