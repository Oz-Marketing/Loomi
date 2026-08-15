import './globals.css';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Providers } from '@/components/providers';
import { LayoutShell, type Surface } from '@/components/layout-shell';
import { appearanceFontVariables } from '@/lib/appearance/fonts';

export const metadata: Metadata = {
  title: 'Loomi Studio',
  description: 'Visual email template editor for Loomi',
};

/**
 * Detect which Loomi surface we're rendering from the request Host header.
 * Done server-side here (rather than via usePathname in LayoutShell) because
 * middleware rewrites the URL internally — usePathname returns the browser
 * URL (`/dashboard`), not the rewritten path (`/reporting/dashboard`), so a
 * client-side pathname check can't distinguish hosts reliably.
 */
/**
 * The EXPLICITLY configured App-surface host, lowercased — or '' when unset.
 * Set on staging (`app-staging.loomilm.com`), where the Studio and App surfaces
 * are NOT sibling subdomains. Returns '' in dev/prod, where the client's
 * prefix/localhost logic already resolves the right host. We publish this (and
 * never the prod default) so the client never overrides that working logic with
 * a wrong `app.loomilm.com` guess in dev.
 */
function configuredAppHost(): string {
  return (
    process.env.NEXT_PUBLIC_APP_SURFACE_HOST ??
    process.env.APP_SURFACE_HOST ??
    ''
  ).toLowerCase();
}

function isMarketingHost(host: string): boolean {
  const marketing = (
    process.env.NEXT_PUBLIC_MARKETING_HOST ??
    process.env.MARKETING_HOST ??
    'loomilm.com'
  ).toLowerCase();
  if (host === marketing || host === `www.${marketing}`) return true;
  if (host === 'marketing.localhost' || host.startsWith('marketing.localhost:')) return true;
  return false;
}

async function resolveSurface(): Promise<Surface> {
  const h = await headers();
  const host = (h.get('host') ?? '').toLowerCase();
  // Public marketing site (loomilm.com apex) — no admin chrome, full-bleed.
  if (isMarketingHost(host)) return 'marketing';
  // The App-surface host is configurable (prod: app.loomilm.com; staging:
  // app-staging.loomilm.com), so match the configured host exactly — not just
  // a hardcoded `app.` prefix — plus the prod convention and the dev host.
  const appHost = configuredAppHost() || 'app.loomilm.com';
  if (host === appHost || host.startsWith('app.')) return 'app';
  return host.startsWith('reporting.') ? 'reporting' : 'studio';
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const surface = await resolveSurface();
  // The proxy sets this header ONLY when it rewrites the apex to /marketing —
  // i.e. for the marketing page itself, not for global paths like /login that
  // also resolve on the marketing host. Gating the bare render on the header
  // (rather than the host-based surface) keeps /login on the full Providers
  // tree so its client hooks (useTheme via <AppLogo>) don't crash.
  const isMarketingPage = (await headers()).get('x-loomi-marketing-page') === '1';

  // Public marketing page: render bare + server-side. The app's global
  // ThemeProvider gates all children behind client hydration (returns null on
  // the server), which would strip the marketing copy + JSON-LD from the
  // initial HTML — bad for SEO. The marketing hero is self-contained and needs
  // none of the app providers, so we render it directly. Locked to the dark
  // theme (the brand `:root`) for a deterministic, dramatic teaser with no
  // hydration flash and no light ancestor to override the jewel-tone aurora.
  if (isMarketingPage) {
    return (
      <html lang="en" data-theme="dark" className={appearanceFontVariables}>
        <body className="min-h-screen">{children}</body>
      </html>
    );
  }

  // Publish the configured App-surface host so client cross-links (the
  // Studio/Projects surface switch) resolve to the right host on staging, where
  // the prefix-swap convention doesn't hold. Mirror of __LOOMI_STUDIO_ORIGIN__
  // (published by the App layout for the reverse direction). Empty in dev/prod
  // → the client falls back to its prefix/localhost logic.
  const appHost = configuredAppHost();
  // The font classes declare every pickable typeface as a CSS variable up front;
  // the Appearance tab's `data-font` attribute chooses which one `--font-sans`
  // resolves to. See src/lib/appearance/fonts.ts.
  return (
    <html lang="en" className={appearanceFontVariables}>
      <body className="flex min-h-screen">
        {appHost && (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.__LOOMI_APP_HOST__=${JSON.stringify(appHost)}`,
            }}
          />
        )}
        <Providers>
          <LayoutShell surface={surface}>
            {children}
          </LayoutShell>
        </Providers>
      </body>
    </html>
  );
}
