import { notFound } from 'next/navigation';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';

/**
 * Server gate for the Ad Generator. The tool isn't ready for general users, so
 * the route 404s unless the env flag is on (e.g. staging) OR the signed-in user
 * is a developer. Runs server-side, so a direct URL can't bypass the hidden nav
 * link.
 */
export default async function AdGeneratorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await adGeneratorAllowed())) notFound();
  return <>{children}</>;
}
