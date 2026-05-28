import { redirect } from 'next/navigation';
import { getAuthSession } from '@/lib/api-auth';
import { ReportingSidebar } from './_components/reporting-sidebar';
import { ReportingTopBar } from './_components/reporting-top-bar';
import { ReportingMain } from './_components/reporting-main';

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

  // Layout matches studio's AppShell structure for visual parity:
  //   - Sidebar and main are siblings inside the root layout's flex body
  //   - Main left-pads enough to clear the fixed sidebar
  //   - No max-width / no centered container — content spans the full
  //     available width, same as studio
  return (
    <>
      <ReportingSidebar />
      <ReportingMain>
        <ReportingTopBar
          userName={session.user.name}
          userEmail={session.user.email}
          userAvatarUrl={session.user.avatarUrl}
          userRole={session.user.role}
        />
        {children}
      </ReportingMain>
    </>
  );
}
