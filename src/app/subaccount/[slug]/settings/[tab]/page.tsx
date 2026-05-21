import { redirect } from 'next/navigation';
import SubAccountSettingsPage from '../page';

interface PageProps {
  params: Promise<{ slug: string; tab: string }>;
}

// Legacy /settings/sending and /settings/suppressions URLs now live
// under /messaging/settings; bounce so bookmarks keep working.
const RELOCATED_TABS = new Set(['sending', 'suppressions']);

export default async function SubAccountSettingsTabRouter({ params }: PageProps) {
  const { slug, tab } = await params;
  if (RELOCATED_TABS.has(tab)) {
    redirect(`/subaccount/${slug}/messaging/settings/${tab}`);
  }
  return <SubAccountSettingsPage />;
}
