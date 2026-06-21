import { notFound } from 'next/navigation';
import { AD_GENERATOR_ENABLED } from '@/lib/feature-flags';

/**
 * Server gate for the Ad Generator. The tool isn't ready for production users,
 * so the route 404s unless the feature flag is enabled for this environment
 * (NEXT_PUBLIC_ENABLE_AD_GENERATOR=true). This runs server-side, so a direct
 * URL can't bypass the hidden nav link.
 */
export default function AdGeneratorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!AD_GENERATOR_ENABLED) notFound();
  return <>{children}</>;
}
