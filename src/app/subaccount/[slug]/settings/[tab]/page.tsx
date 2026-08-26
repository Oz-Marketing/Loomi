import { redirect } from 'next/navigation';
import SubAccountSettingsPage from '../page';

interface PageProps {
  params: Promise<{ slug: string; tab: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

export default async function SubAccountSettingsTabRouter({ params, searchParams }: PageProps) {
  const { slug, tab } = await params;
  const query = await searchParams;

  // Email & Texts moved to the Studio settings rail, where the tab IS taken from the
  // path. It used to live in this drill-in, whose only URL handling is `?tab=` — the
  // path segment was never read, so every one of these links landed on General. The
  // blast preflight's "fix this in settings" remedy and the suppression widget both
  // point here, so both were quietly wrong; redirecting fixes them rather than
  // preserving the bug for compatibility.
  if (tab === 'email-texts' || MERGED_SECTIONS[tab]) {
    // An incoming `?section=` wins: the old per-section segments map onto a section,
    // but a link to `email-texts?section=suppressions` already carries the one it
    // wants and dropping it would land every remedy link on Sending Config.
    const incoming = typeof query.section === 'string' ? query.section : undefined;
    const section = incoming ?? MERGED_SECTIONS[tab];
    redirect(`/settings/email-texts${section ? `?section=${section}` : ''}`);
  }
  // `company` was renamed to `general`. The client reads the old key as the new
  // one anyway, but redirecting keeps the URL honest about which tab you're on.
  if (tab === 'company') {
    redirect(`/subaccount/${slug}/settings/general`);
  }
  return <SubAccountSettingsPage />;
}
