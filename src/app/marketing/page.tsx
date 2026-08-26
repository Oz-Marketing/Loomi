import { headers } from 'next/headers';
import Link from 'next/link';
import { ArrowRightIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import { APP_LOGO_DARK_URL } from '@/components/app-logo';
import { SITE, marketingBaseUrl } from '@/lib/marketing/seo';

/**
 * Public marketing hero for loomilm.com.
 *
 * Server-rendered (only <AppLogo> is a client island) so crawlers get the
 * full copy + JSON-LD in the initial HTML. The visual language mirrors the
 * admin app's signature: the drifting iris-aurora backdrop, the rainbow
 * gradient, the rotating beam, and the glass surfaces — so the marketing
 * site reads as the same product, not a detached splash page.
 *
 * The Sign-in CTAs route to the global /login with a `callbackUrl` pointing
 * at the App surface (app.loomilm.com) — the root admin directory — so a
 * successful login from here lands on App rather than Studio.
 */

/**
 * The App-surface origin that corresponds to the current marketing host.
 * Prefers the explicitly-configured surface host (staging), then maps the
 * dev `marketing.localhost` and the prod apex to their `app.*` siblings.
 */
function resolveAppOrigin(host: string, proto: string): string {
  const explicit = (
    process.env.NEXT_PUBLIC_APP_SURFACE_HOST ??
    process.env.APP_SURFACE_HOST ??
    ''
  ).toLowerCase();
  if (explicit) return `${proto}://${explicit}`;

  // Local dev: marketing.localhost(:PORT) → app.localhost(:PORT)
  if (host === 'marketing.localhost' || host.startsWith('marketing.localhost:')) {
    return `${proto}://${host.replace(/^marketing\./, 'app.')}`;
  }
  // Prod apex (loomilm.com / www.loomilm.com) → app.loomilm.com
  const apex = host.replace(/^www\./, '');
  if (apex && !apex.includes('localhost')) return `${proto}://app.${apex}`;

  return 'https://app.loomilm.com';
}

export default async function MarketingPage() {
  const h = await headers();
  const host = (h.get('host') ?? marketingBaseUrl().replace(/^https?:\/\//, '')).toLowerCase();
  const proto = h.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https');
  const appOrigin = resolveAppOrigin(host, proto);
  const loginHref = `/login?callbackUrl=${encodeURIComponent(`${appOrigin}/`)}`;
  const year = new Date().getFullYear();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${marketingBaseUrl()}/#organization`,
        name: SITE.legalName,
        url: marketingBaseUrl(),
        description: SITE.description,
      },
      {
        '@type': 'WebSite',
        '@id': `${marketingBaseUrl()}/#website`,
        name: SITE.name,
        url: marketingBaseUrl(),
        publisher: { '@id': `${marketingBaseUrl()}/#organization` },
        description: SITE.description,
      },
    ],
  };

  return (
    <main className="relative flex min-h-screen w-full flex-col overflow-hidden">
      {/* JSON-LD structured data for rich results */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Faded grid — subtle technical texture sitting beneath the aurora.
          Radially masked so it's strongest behind the hero and dissolves into
          the dark canvas at the edges, blending rather than gridding the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage:
            'radial-gradient(ellipse 75% 65% at 50% 42%, #000 0%, transparent 78%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 75% 65% at 50% 42%, #000 0%, transparent 78%)',
        }}
      />

      {/* Loomi aurora — the five independently-drifting brand blobs, full-bleed
          behind everything. Same classes as the in-app AI heroes. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="iris-aurora-blob iris-aurora-blob-1" />
        <span className="iris-aurora-blob iris-aurora-blob-2" />
        <span className="iris-aurora-blob iris-aurora-blob-3" />
        <span className="iris-aurora-blob iris-aurora-blob-4" />
        <span className="iris-aurora-blob iris-aurora-blob-5" />
      </div>
      {/* Vignette so the headline reads cleanly over the aurora in dark mode. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.28) 100%)',
        }}
      />

      {/* Top bar */}
      <header className="relative z-10 flex h-20 items-center justify-between px-6 sm:px-10">
        {/* Dark-mode wordmark — the marketing surface is locked to the dark
            theme, so we use the dark logo directly (no client useTheme). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={APP_LOGO_DARK_URL} alt={SITE.name} className="h-8 w-auto" />
        <Link
          href={loginHref}
          aria-label="Sign in to Loomi"
          className="group inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-4 text-sm font-medium text-[var(--foreground)] backdrop-blur-xl transition hover:bg-[var(--muted)]"
        >
          <span>Sign in</span>
          <ArrowRightOnRectangleIcon className="h-4 w-4 text-[var(--muted-foreground)] transition group-hover:translate-x-0.5 group-hover:text-[var(--foreground)]" />
        </Link>
      </header>

      {/* Hero */}
      <section className="animate-fade-in-up relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        {/* Eyebrow */}
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] backdrop-blur-xl">
          <span className="iris-rainbow-gradient h-2 w-2 rounded-full" />
          Something extraordinary is taking shape
        </div>

        {/* Headline */}
        <h1 className="mt-6 max-w-4xl text-4xl font-bold leading-[1.05] tracking-tight text-[var(--foreground)] sm:text-6xl lg:text-7xl">
          The AI marketing platform,{' '}
          <span className="iris-rainbow-gradient inline-block bg-clip-text text-transparent">
            reimagined
          </span>
          .
        </h1>

        {/* Subhead */}
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-[var(--muted-foreground)] sm:text-lg">
          Campaigns, flows, landing pages, and analytics — built together and
          powered by AI. We&rsquo;re putting the finishing touches on something
          special.
        </p>

        {/* CTA row */}
        <div className="mt-9 flex flex-col items-center gap-4 sm:flex-row">
          <div className="iris-beam-wrap rounded-full">
            <Link
              href={loginHref}
              className="relative inline-flex h-12 items-center gap-2 rounded-full bg-[var(--card-strong)] px-6 text-sm font-semibold text-[var(--foreground)] backdrop-blur-xl transition hover:opacity-90"
            >
              Sign in
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
          <span className="text-sm font-medium text-[var(--muted-foreground)]">
            More is coming soon — stay tuned.
          </span>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 flex flex-col items-center gap-1 px-6 py-6 text-center text-xs text-[var(--muted-foreground)] sm:px-10">
        <span>
          &copy; {year} {SITE.name}. All rights reserved.
        </span>
      </footer>
    </main>
  );
}
