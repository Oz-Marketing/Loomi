import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ slug: string; tab: string }>;
}

/**
 * Email/SMS/Suppressions settings moved into Settings → Studio Settings →
 * Email & Texts (2026-08-20). Bounce so bookmarks keep working.
 *
 * The reverse redirect in ../../settings/[tab] was removed in the same
 * change; both directions at once is an infinite loop.
 */
const SECTIONS: Record<string, string> = {
  sending: 'sending',
  sms: 'sending',
  suppressions: 'suppressions',
};

export default async function LegacyMessagingSettingsTab({ params }: PageProps) {
  const { slug, tab } = await params;
  const section = SECTIONS[tab] ?? 'sending';
  redirect(`/subaccount/${slug}/settings/email-texts?section=${section}`);
}
