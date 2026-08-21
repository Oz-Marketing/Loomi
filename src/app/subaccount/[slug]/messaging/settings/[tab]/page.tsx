import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ slug: string; tab: string }>;
}

/**
 * Email/SMS/Suppressions settings moved back into Settings → Studio Settings
 * (2026-08-20). Bounce so bookmarks and any link we missed keep working.
 *
 * The reverse redirect in ../../settings/[tab] was removed in the same change;
 * both directions at once is an infinite loop.
 */
export default async function LegacyMessagingSettingsTab({ params }: PageProps) {
  const { slug, tab } = await params;
  const known = new Set(['sending', 'sms', 'suppressions']);
  redirect(`/subaccount/${slug}/settings/${known.has(tab) ? tab : 'sending'}`);
}
