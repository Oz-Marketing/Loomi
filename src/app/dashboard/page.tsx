/**
 * Studio home (admin / global). Renders the same `StudioHome` as the
 * sub-account dashboard does — analytics moved to `/reporting`, so
 * both views are now creative-tool landing pages.
 *
 * Clients don't get the Studio home (their whole experience is the Ad
 * Generator), so this server component bounces them there before rendering.
 */
import { redirect } from 'next/navigation';
import { getAuthSession } from '@/lib/api-auth';
import { StudioHome } from '@/components/studio-home';

export default async function DashboardPage() {
  const session = await getAuthSession();
  if (session?.user?.role === 'client') redirect('/ad-generator');
  return <StudioHome />;
}
