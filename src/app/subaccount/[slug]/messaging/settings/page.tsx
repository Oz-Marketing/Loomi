import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Moved into Settings → Studio Settings (2026-08-20). */
export default async function LegacyMessagingSettingsIndex({ params }: PageProps) {
  const { slug } = await params;
  redirect(`/subaccount/${slug}/settings/sending`);
}
