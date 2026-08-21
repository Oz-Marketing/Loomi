import { NextRequest, NextResponse } from 'next/server';
import { buildLoaderScript } from '@/lib/forms/embed-loader';

/**
 * Serves the auto-resizing iframe loader at `/loomi-form.js`.
 * The script body (and the embed contract it implements) lives in
 * `lib/forms/embed-loader.ts`, where it can be unit-tested against jsdom.
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
