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
async function resolveSurface(): Promise<Surface> {
  const h = await headers();
  const host = (h.get('host') ?? '').toLowerCase();
  // The App-surface host is configurable (prod: app.loomilm.com; staging:
  // app-staging.loomilm.com), so match the configured host exactly — not just
  // a hardcoded `app.` prefix — plus the prod convention and the dev host.
  const appHost = (
    process.env.NEXT_PUBLIC_APP_SURFACE_HOST ??
    process.env.APP_SURFACE_HOST ??
    'app.loomilm.com'
  ).toLowerCase();
  if (host === appHost || host.startsWith('app.')) return 'app';
  return host.startsWith('reporting.') ? 'reporting' : 'studio';
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const surface = await resolveSurface();
  return (
    <html lang="en">
      <body className="flex min-h-screen">
        <Providers>
          <LayoutShell surface={surface}>
            {children}
          </LayoutShell>
        </Providers>
      </body>
    </html>
  );
}
