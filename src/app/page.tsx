import { redirect } from 'next/navigation';
import { getAuthSession } from '@/lib/api-auth';

export default async function RootPage() {
  // Clients only have the Ad Generator — send them straight there rather than
  // through the Studio home they can't use.
  const session = await getAuthSession();
  if (session?.user?.role === 'client') redirect('/ad-generator');
  redirect('/dashboard');
}
