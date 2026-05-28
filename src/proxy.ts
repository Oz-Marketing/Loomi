/**
 * Edge proxy — host-aware routing + auth/role enforcement.
 *
 * Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`; this
 * file consolidates both the host-aware rewriting (previously in a
 * root-level middleware.ts that Next 16 no longer auto-detects when
 * proxy.ts is present) and the auth/role checks.
 *
 * Three host classes:
 *   1. Studio base (`studio.loomilm.com`, localhost, APP_HOST_EXTRAS) —
 *      passthrough; serve the full app as-is.
 *   2. Reporting (`reporting.loomilm.com`) — rewrite non-global app
 *      paths to `/reporting/*` so one Next.js app serves the client
 *      reporting surface from its own hostname.
 *   3. Custom landing-page domains — rewrite to `/lp/<slug>`; the
 *      route resolves AccountDomain from the Host header.
 *
 * After host rewriting, the existing auth check runs against the
 * rewritten path so /reporting/* still gets gated to logged-in users.
 */
import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const CUSTOM_DOMAIN_HOME_SLUG = '__home__';

// Top-level studio pages that have sub-account equivalents — client-role
// users get redirected from these to their default sub-account.
const ADMIN_PAGES = [
  '/dashboard',
  '/contacts',
  '/messaging',
  '/campaigns', // legacy — redirects under /messaging now, kept so client-role redirect still fires
  '/email',
  '/templates', // legacy — redirects under /email now
  '/flows',
  '/settings',
];

function resolveBaseHost(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_HOST ?? process.env.APP_HOST;
  if (explicit) return explicit.toLowerCase();
  const fromNextAuth = process.env.NEXTAUTH_URL;
  if (fromNextAuth) {
    try {
      return new URL(fromNextAuth).host.toLowerCase();
    } catch {
      /* malformed — fall through */
    }
  }
  return 'studio.loomilm.com';
}

function resolveReportingHost(): string {
  const explicit = process.env.NEXT_PUBLIC_REPORTING_HOST ?? process.env.REPORTING_HOST;
  if (explicit) return explicit.toLowerCase();
  return 'reporting.loomilm.com';
}

function isReportingHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === resolveReportingHost()) return true;
  // Local dev: reporting.localhost(:PORT)
  if (lower === 'reporting.localhost' || lower.startsWith('reporting.localhost:')) return true;
  return false;
}

function isBaseHost(host: string): boolean {
  const lower = host.toLowerCase();
  const base = resolveBaseHost();
  if (lower === base) return true;
  if (lower === 'localhost' || lower.startsWith('localhost:')) return true;
  // Other `*.localhost` (excluding reporting.localhost which is handled separately)
  if (lower.endsWith('.localhost') && !lower.startsWith('reporting.')) return true;
  const extras = (process.env.APP_HOST_EXTRAS ?? process.env.NEXT_PUBLIC_APP_HOST_EXTRAS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return extras.includes(lower);
}

/**
 * Paths that should never be rewritten by host-based routing.
 * These hit the global app routes regardless of which host the
 * request came in on (API, auth, internals, public assets).
 *
 * IMPORTANT: any path mapped to `/api/*` via `next.config.js` rewrites
 * must be listed here too. Edge middleware (this proxy) runs BEFORE
 * `next.config.js` rewrites, so paths like `/avatars/<file>` would
 * otherwise get host-rewritten to `/reporting/avatars/<file>` (404)
 * before the config rewrite to `/api/avatars/<file>` can apply.
 */
function isGlobalAppPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/__nextjs/') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname === '/lp-sitemap.xml' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/logout') ||
    // Asset paths mapped to /api/* via next.config.js rewrites — must
    // bypass host rewriting so the next.config rewrite applies cleanly.
    pathname.startsWith('/avatars/') ||
    pathname.startsWith('/logos/')
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get('host');

  // ── Host-aware routing ─────────────────────────────────────────────

  if (host && isReportingHost(host)) {
    // Rewrite non-global app paths into the /reporting tree. Already-canonical
    // /reporting/* paths and global paths (api/auth, login, _next, etc.) fall
    // through to the auth check below.
    if (!pathname.startsWith('/reporting') && !isGlobalAppPath(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = pathname === '/' ? '/reporting' : `/reporting${pathname}`;
      return NextResponse.rewrite(url);
    }
  } else if (host && !isBaseHost(host)) {
    // Custom LP domain — rewrite to /lp/<slug>. Skip API, internals, and
    // already-canonical /lp/* paths.
    if (!isGlobalAppPath(pathname) && !pathname.startsWith('/lp/')) {
      const segments = pathname.split('/').filter(Boolean);
      const slug = segments.length === 0 ? CUSTOM_DOMAIN_HOME_SLUG : segments[0]!;
      const remainder = segments.length > 1 ? '/' + segments.slice(1).join('/') : '';
      const url = request.nextUrl.clone();
      url.pathname = `/lp/${slug}${remainder}`;
      return NextResponse.rewrite(url);
    }
  }

  // ── Auth + role enforcement ───────────────────────────────────────

  // Public/passthrough paths — no auth required
  if (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/onboarding/') ||
    pathname.startsWith('/api/webhooks/') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/onboarding') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/lp/') ||
    pathname.startsWith('/f/')
  ) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request });

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Client-role users get redirected from top-level admin pages to their sub-account
  if (token.role === 'client' && token.defaultAccountSlug) {
    const isAdminPage = ADMIN_PAGES.some(
      (page) => pathname === page || pathname.startsWith(`${page}/`)
    );
    if (isAdminPage) {
      const url = request.nextUrl.clone();
      url.pathname = `/subaccount/${token.defaultAccountSlug}${pathname}`;
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
