'use client';

/**
 * Sub-account home. Same `StudioHome` as the admin dashboard but with
 * quick-link destinations scoped under `/subaccount/<slug>/*` so
 * clicking "Build a Campaign" stays inside the active sub-account.
 */
import { useParams } from 'next/navigation';
import { StudioHome } from '@/components/studio-home';

export default function SubaccountDashboard() {
  const params = useParams();
  const slug = typeof params.slug === 'string' ? params.slug : '';
  return <StudioHome prefix={slug ? `/subaccount/${slug}` : ''} />;
}
