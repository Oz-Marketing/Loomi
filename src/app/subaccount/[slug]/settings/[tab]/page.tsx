import { redirect } from 'next/navigation';
import SubAccountSettingsPage from '../page';

interface PageProps {
  params: Promise<{ slug: string; tab: string }>;
}

// NOTE: `sending` and `suppressions` used to redirect OUT of here to
// /messaging/settings. They render here again, so that redirect is gone —
// leaving it while the messaging routes bounce back here would be an
// infinite loop.
export default async function SubAccountSettingsTabRouter({ params }: PageProps) {
  const { slug, tab } = await params;
  // `company` was renamed to `general`. The client reads the old key as the new
  // one anyway, but redirecting keeps the URL honest about which tab you're on.
  if (tab === 'company') {
    redirect(`/subaccount/${slug}/settings/general`);
  }
  return <SubAccountSettingsPage />;
}
