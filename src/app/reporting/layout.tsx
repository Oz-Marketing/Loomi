import { redirect } from 'next/navigation';
import { getAuthSession } from '@/lib/api-auth';
import { ReportingSidebar } from './_components/reporting-sidebar';

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
    redirect('/login?callbackUrl=/reporting');
  }

  return (
    <div className="flex min-h-screen flex-1">
      <ReportingSidebar
        name={session.user.name}
        email={session.user.email}
        avatarUrl={session.user.avatarUrl}
      />
      {/* Main content offset by the fixed sidebar width (w-60 = 15rem) + gutters */}
      <main className="ml-[16rem] flex-1 px-8 py-10">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
