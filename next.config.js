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
  // NOT included yet: Content-Security-Policy. A nonce-based CSP forces every
  // page to render dynamically, and the app currently inlines a bootstrap
  // <script> in the root layout (window.__LOOMI_APP_HOST__), so enforcing one
  // blind would break staging. Add it as Report-Only first, clear the reports,
  // then enforce — tracked separately.
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
