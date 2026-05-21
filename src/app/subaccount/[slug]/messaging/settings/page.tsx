import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ slug: string }>;
}

// /subaccount/<slug>/messaging/settings → bounce to the sending tab.
// Mirrors the existing /settings → /settings/company default-tab pattern.
export default async function SubaccountMessagingSettingsRedirect({ params }: PageProps) {
  const { slug } = await params;
  redirect(`/subaccount/${slug}/messaging/settings/sending`);
}
