import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';

/**
 * Legacy redirect: an account's settings live in ONE place now.
 *
 * `/subaccount/<slug>/settings/<tab>` used to render the sub-account settings
 * in the app shell, with its sections in the sidebar — the same screens the
 * Agency Settings → Accounts drill-in already showed, reached a second way.
 * That variant is gone; this bounces the old URLs (and any bookmark) to the
 * agency route, which is now the only one.
 *
 * A server component so the slug→key lookup happens before anything renders,
 * rather than flashing a page and then navigating.
 */
interface PageProps {
  params: Promise<{ slug: string; tab?: string[] }>;
}

/** Sending and Suppressions moved to the messaging-scoped settings page. */
const MESSAGING_TABS = new Set(['sending', 'suppressions']);

export default async function LegacySubAccountSettingsRedirect({ params }: PageProps) {
  const { slug, tab } = await params;
  const section = tab?.[0];

  if (section && MESSAGING_TABS.has(section)) {
    redirect(`/subaccount/${slug}/messaging/settings/${section}`);
  }

  const account = await prisma.account.findUnique({
    where: { slug },
    select: { key: true },
  });

  // No such slug — the surface's own settings, which every role can reach.
  // NOT /settings/subaccounts: that's a [key]-only route with no index page,
  // so it would have been one dead end swapped for another.
  if (!account) redirect('/settings');

  // `company` was the old name for `general`; the detail page reads either, but
  // carrying it through keeps the URL honest about which tab you land on.
  const canonical = section === 'company' ? 'general' : section;
  redirect(
    canonical
      ? `/settings/subaccounts/${account.key}?tab=${canonical}`
      : `/settings/subaccounts/${account.key}`,
  );
}
