import { redirect } from 'next/navigation';
import SubAccountSettingsPage from '../page';

interface PageProps {
  params: Promise<{ slug: string; tab: string }>;
}

// Sending / SMS / Suppressions / Email Footer were briefly four sibling
// sections here; they're now sub-tabs of one "Email & Texts" section. Map the
// old segments onto it so bookmarks land on the right tab.
//
// NOTE: these segments also used to redirect OUT to /messaging/settings.
// That is gone — bouncing both ways at once is an infinite loop.
const MERGED_SECTIONS: Record<string, string> = {
  sending: 'sending',
  sms: 'sending',
  'email-footer': 'footer',
  suppressions: 'suppressions',
};

export default async function SubAccountSettingsTabRouter({ params }: PageProps) {
  const { slug, tab } = await params;
  const section = MERGED_SECTIONS[tab];
  if (section) {
    redirect(`/subaccount/${slug}/settings/email-texts?section=${section}`);
  }
  // `company` was renamed to `general`. The client reads the old key as the new
  // one anyway, but redirecting keeps the URL honest about which tab you're on.
  if (tab === 'company') {
    redirect(`/subaccount/${slug}/settings/general`);
  }
  return <SubAccountSettingsPage />;
}
