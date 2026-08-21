import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { accountSettingsHref } from '@/lib/account-settings-href';
import { accountTabForMessagingSection } from '@/lib/messaging-settings-redirect';

/**
 * Legacy redirect. Sending, SMS and Suppressions are tabs on the account now —
 * see lib/messaging-settings-redirect for why.
 *
 * A server component so the slug→key lookup happens before anything renders,
 * rather than flashing a page and then navigating.
 */
interface PageProps {
  params: Promise<{ slug: string; tab?: string[] }>;
}

export default async function LegacyMessagingSettingsRedirect({ params }: PageProps) {
  const { slug, tab } = await params;
  const account = await prisma.account.findUnique({
    where: { slug },
    select: { key: true },
  });
  // No such slug — the surface's own settings, not a dead end.
  if (!account) redirect('/settings');
  redirect(accountSettingsHref(account.key, accountTabForMessagingSection(tab?.[0])));
}
