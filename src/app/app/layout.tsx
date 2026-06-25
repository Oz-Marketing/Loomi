import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuthSession } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/roles';
import { SurfaceShell } from '@/components/surface-shell';
import { AppSidebar } from './_components/app-sidebar';
import { AppTopBar } from './_components/app-top-bar';

export const metadata = {
  title: 'Loomi App',
  description: 'Projects & operations workspace for the Loomi team',
};

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
    const h = await headers();
    const host = (h.get('host') ?? '').toLowerCase();
    const rest = host.startsWith('app.') ? host.slice('app.'.length) : host;
    const studioHost = rest.startsWith('localhost') ? rest : `studio.${rest}`;
    const proto = host.includes('localhost') ? 'http' : 'https';
    redirect(`${proto}://${studioHost}/`);
  }

  // Publish the canonical studio origin (from NEXTAUTH_URL) so client cross-
  // links (Open in Studio / Build it) resolve correctly whether studio lives
  // at a sibling subdomain (prod: studio.loomilm.com) or the bare env domain
  // (staging: staging.loomilm.com).
  let studioOrigin: string | null = null;
  try {
    studioOrigin = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : null;
  } catch {
    studioOrigin = null;
  }

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
