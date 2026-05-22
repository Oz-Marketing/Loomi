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
