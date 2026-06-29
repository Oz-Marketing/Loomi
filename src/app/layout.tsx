import './globals.css';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Providers } from '@/components/providers';
import { LayoutShell, type Surface } from '@/components/layout-shell';

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

async function resolveSurface(): Promise<Surface> {
  const h = await headers();
  const host = (h.get('host') ?? '').toLowerCase();
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
  // Publish the configured App-surface host so client cross-links (the
  // Studio/Projects surface switch) resolve to the right host on staging, where
  // the prefix-swap convention doesn't hold. Mirror of __LOOMI_STUDIO_ORIGIN__
  // (published by the App layout for the reverse direction). Empty in dev/prod
  // → the client falls back to its prefix/localhost logic.
  const appHost = configuredAppHost();
  return (
    <html lang="en">
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
