import { notFound, redirect } from 'next/navigation';
import { getAccountScope, getAuthSession } from '@/lib/api-auth';
import { getLandingPage } from '@/lib/services/landing-pages';

/**
 * Landing-page detail layout. PR1 just acts as an auth + existence
 * gate; PR3 will introduce a LandingPageDetailProvider here that
 * shares the page state across overview / builder / settings the way
 * FormDetailProvider does for forms.
 */
export default async function LandingPageDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await getAuthSession();
  if (!session?.user) redirect('/login');
  if (!['developer', 'super_admin', 'admin'].includes(session.user.role)) notFound();

  const { id } = await params;
  const page = await getLandingPage(id, getAccountScope(session));
  if (!page) notFound();

  return <>{children}</>;
}
