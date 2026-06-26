import { redirect } from 'next/navigation';
import { getAuthSession } from '@/lib/api-auth';
import { SurfaceShell } from '@/components/surface-shell';
import { ReportingSidebar } from './_components/reporting-sidebar';
import { ReportingTopBar } from './_components/reporting-top-bar';

export const metadata = {
  title: 'Loomi Reporting',
  description: 'Client-facing reporting for Loomi accounts',
};

export default async function ReportingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAuthSession();
  if (!session?.user) {
    // callbackUrl is the BROWSER-facing path on whichever host we're
    // currently on. On reporting.loomilm.com, `/` rewrites to /reporting
    // via middleware, so `/` is the correct value here (sending the user
    // to `/reporting` would produce the redundant URL
    // `reporting.loomilm.com/reporting`).
    redirect('/login?callbackUrl=/');
  }

  // Reporting + studio share one shell (SurfaceShell) so the layout, content
  // card, and scroll/sticky behavior stay identical across surfaces — only the
  // sidebar + top bar differ.
  return (
    <SurfaceShell
      sidebar={<ReportingSidebar />}
      topBar={
        <ReportingTopBar
          userName={session.user.name}
          userEmail={session.user.email}
          userAvatarUrl={session.user.avatarUrl}
          userRole={session.user.role}
        />
      }
    >
      {children}
    </SurfaceShell>
  );
}
