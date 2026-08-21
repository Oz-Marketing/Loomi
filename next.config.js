// ── Content-Security-Policy, in REPORT-ONLY ──
//
// Nothing below blocks anything. The browser evaluates the policy, allows the
// request regardless, and POSTs a report to /api/csp-report. That is the point:
// a policy written from reading the code, rather than from what the app is
// observed to load, is how you take a product down on a Friday.
//
// The values here are the INTENDED enforced policy, deliberately including no
// `'unsafe-inline'` for scripts even though three inline scripts are known to
// exist (the root layout's host bootstrap, the App layout's, and JSON-LD). If
// they were allowed up front the reports would not mention them, and the
// nonce work needed before enforcement would stay invisible.
//
// Known third parties, from an inventory of what actually loads at runtime:
//   challenges.cloudflare.com   Turnstile, on public forms
//   www.gstatic.com             Google Charts loader, in reporting
//
// `img-src https:` is broad on purpose and will stay that way. Account logos
// are dealer-supplied URLs on arbitrary CDNs; enumerating them is not possible.
//
// READ THE REPORTS FROM PRODUCTION, NOT DEV. A local run immediately reports
// `script-src <- eval`, which is webpack's dev source-map machinery and does not
// exist in a production build. Building an allowlist from dev traffic would add
// 'unsafe-eval' to the real policy for no reason, which is most of the value of
// having one thrown away.
//
// TO ENFORCE, once the reports are quiet: add a nonce in the root layout,
// attach it to the three inline scripts, swap this header name to
// `Content-Security-Policy`, and accept that a nonce forces dynamic rendering
// (the marketing page is deliberately SSR for SEO, so measure that before
// committing to it).
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com https://www.gstatic.com",
  // Tailwind and the ad/template renderers inject style attributes; a nonce
  // cannot cover those, so style stays permissive in the intended policy too.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "frame-src 'self' https://challenges.cloudflare.com https://www.youtube.com",
  "media-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  'report-uri /api/csp-report',
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this file's directory so Next.js doesn't
  // warn about "multiple lockfiles" in production. The blue/green
  // deploy lays releases out at /var/www/loomi-studio/releases/<id>/,
  // each carrying its own package-lock.json. There's also a
  // package-lock.json at /var/www/loomi-studio/ (the deploy keeps a
  // working git tree there for `git pull`). Without this hint Next.js
  // tries to auto-detect and emits a noisy warning every boot.
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ['yaml', 'puppeteer', 'puppeteer-core', 'sharp'],
  // Baseline security headers. `headers()` applies to every response Next
  // serves — success, redirect, 401 and 5xx alike — which is the point: an
  // audit found these absent on BOTH a 200 login page and a 401 API response,
  // so protections were disappearing on exactly the paths that need them.
  //
  // Content-Security-Policy ships REPORT-ONLY, on the app surfaces only — see
  // CSP_REPORT_ONLY above for the policy and the path to enforcing it.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // 2 years + preload, matching the HSTS preload list's requirements.
          // Safe here: every Loomi surface is HTTPS-only behind Cloudflare.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          // Blocks MIME sniffing — a user-uploaded asset served from our own
          // origin (logos, avatars, media) can't be coaxed into running as
          // script because a browser guessed the type.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Clickjacking. SAMEORIGIN rather than DENY: the template/landing-page
          // editors preview their own output in same-origin iframes.
          // Public embedded forms are exempted by the /f/ rule below.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Send the full URL only to ourselves; cross-origin gets the bare
          // origin. Loomi paths carry account keys and record ids.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Nothing in the app uses these; deny them rather than inherit the
          // browser default.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
      {
        // Public form pages are DESIGNED to be framed cross-origin — the
        // /loomi-form.js snippet injects an <iframe src="/f/<slug>?embed=1">
        // into the dealer's own website. The blanket SAMEORIGIN above would
        // blank every one of those embeds.
        //
        // `frame-ancestors` rather than dropping X-Frame-Options via a negative
        // path match: per CSP Level 2, when frame-ancestors is present browsers
        // MUST ignore X-Frame-Options entirely, so this cleanly overrides the
        // rule above without relying on path-to-regexp lookahead.
        source: '/f/:path*',
        headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }],
      },
      {
        // CSP goes on the APP surfaces only.
        //
        // Explicitly NOT on /lp/* : landing pages let a dealer paste arbitrary
        // <script> into the page head and pre-body — chat widgets, tracking
        // pixels, whatever their agency gave them. That is the feature. Any
        // script-src worth having would break every one of them, and a policy
        // with a hole that big is not worth enforcing. Same for /f/*, which
        // loads Turnstile inside a customer's own site.
        //
        // Negative lookahead rather than listing every app path, so a new route
        // is covered by default and only the two exclusions are deliberate.
        source: '/((?!lp/|f/|api/).*)',
        headers: [{ key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY }],
      },
      // Logos and avatars are gated to a session by proxy.ts, so they must not
      // sit in a shared cache. Setting that on the API routes alone is not
      // enough: `/logos/*` and `/avatars/*` are rewritten to `/api/logos/*` and
      // `/api/avatars/*` by an afterFiles rewrite, and Next resolves FILESYSTEM
      // routes before those — so any file still present in `public/` is served
      // by the static handler and the route's headers never run. `headers()`
      // runs before both, which is why the policy belongs here.
      //
      // max-age=0 + must-revalidate rather than a long immutable TTL because
      // logo filenames are stable (`light.png` forever): a re-uploaded logo has
      // to be able to replace a cached one. The route pairs this with an ETag
      // so revalidation is a bodyless 304.
      ...['/logos/:path*', '/avatars/:path*'].map((source) => ({
        source,
        headers: [{ key: 'Cache-Control', value: 'private, max-age=0, must-revalidate' }],
      })),
      {
        // Loomi's own brand marks — deliberately the OPPOSITE policy to the two
        // above. Those are tenant data behind a session, so they must not enter
        // a shared cache. These are the company logo: served to logged-out
        // visitors on the login page and to email clients with no session at
        // all, so shared caching is not a leak, it is the point.
        //
        // A day of freshness with a week of stale-while-revalidate: a rebrand
        // reaches everyone within a day, and in the meantime nobody pays a
        // round trip for a file that changes once a year. Not `immutable` —
        // these paths are stable names, and that is exactly the trap that made
        // re-uploaded account logos un-bustable for a year.
        source: '/brand/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        // Serve legacy /logos/* URLs through the API route
        // (Next.js doesn't serve files added to /public after build)
        source: '/logos/:path*',
        destination: '/api/logos/:path*',
      },
      {
        // Serve legacy /avatars/* URLs through the API route
        source: '/avatars/:path*',
        destination: '/api/avatars/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
