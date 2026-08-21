'use client';

import { useParams } from 'next/navigation';
import { SubAccountDetailPage } from '@/components/subaccount-detail';

// Mirrors the Studio settings sub-account detail (same component + browser
// basePath); served under the App shell on the App host. → the
// sidebar shows the sub-account's sections (incl. Integrations).
export default function Page() {
  const params = useParams();
  const key = (params?.key as string) || '';
  return <SubAccountDetailPage basePath="/settings/subaccounts" accountKeyProp={key} />;
}
