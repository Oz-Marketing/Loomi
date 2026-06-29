import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuthSession } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/roles';
import { SurfaceShell } from '@/components/surface-shell';
import { AppSidebar } from './_components/app-sidebar';
import { AppTopBar } from './_components/app-top-bar';

export const metadata = {
  title: 'Loomi',
  description: 'Projects & operations workspace for the Loomi team',
};

/**
 * The canonical Studio origin from NEXTAUTH_URL (e.g. https://studio.loomilm.com
 * in prod, https://staging.loomilm.com on staging, http://localhost:3000 in dev),
 * or null if NEXTAUTH_URL is unset/malformed. This is the authoritative source —
 * the App-surface host can't be prefix-stripped into the Studio host (staging's
 * `app-staging.loomilm.com` has no `app.` prefix), and proxy.ts derives the base
 * host from NEXTAUTH_URL the same way.
 */
function studioOriginFromEnv(): string | null {
  try {
    return process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : null;
  } catch {
    return null;
  }
}

/**
 * App surface layout (app.loomilm.com). Hosts the internal Projects
 * workspace today; the client-facing Reporting tree relocates here in a
 * fast-follow. Shares SurfaceShell with studio/reporting so layout, the
 * content card, and scroll/sticky behavior stay identical — only the
 * sidebar + top bar differ.
 */
export default async function AppSurfaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAuthSession();
  if (!session?.user) {
    // `/` rewrites to `/app` on app.loomilm.com, so `/` is the correct
    // post-login callback (sending them to `/app` would be redundant).
    redirect('/login?callbackUrl=/');
  }

  // Projects is internal-staff only in v1. Bounce client-role users back to
  // Studio (cross-host) until the client-facing Reporting tree lands here.
  if (!MANAGEMENT_ROLES.includes(session.user.role)) {
    // Prefer the authoritative Studio origin from NEXTAUTH_URL. Fall back to
    // prefix-stripping the App host only when NEXTAUTH_URL is unset/malformed
    // (the fallback is wrong on staging, where App is `app-staging.loomilm.com`
    // and Studio is the bare `staging.loomilm.com`).
    let target = studioOriginFromEnv();
    if (!target) {
      const h = await headers();
      const host = (h.get('host') ?? '').toLowerCase();
      const rest = host.startsWith('app.') ? host.slice('app.'.length) : host;
      const studioHost = rest.startsWith('localhost') ? rest : `studio.${rest}`;
      const proto = host.includes('localhost') ? 'http' : 'https';
      target = `${proto}://${studioHost}`;
    }
    redirect(`${target}/`);
  }

  // Publish the canonical studio origin (from NEXTAUTH_URL) so client cross-
  // links (Open in Studio / Build it) resolve correctly whether studio lives
  // at a sibling subdomain (prod: studio.loomilm.com) or the bare env domain
  // (staging: staging.loomilm.com).
  const studioOrigin = studioOriginFromEnv();

  return (
    <>
      {studioOrigin && (
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__LOOMI_STUDIO_ORIGIN__=${JSON.stringify(studioOrigin)}`,
          }}
        />
      )}
      <SurfaceShell
        sidebar={<AppSidebar />}
        topBar={
          <AppTopBar
            userName={session.user.name}
            userEmail={session.user.email}
            userAvatarUrl={session.user.avatarUrl}
            userRole={session.user.role}
          />
        }
      >
        {children}
      </SurfaceShell>
    </>
  );
}
