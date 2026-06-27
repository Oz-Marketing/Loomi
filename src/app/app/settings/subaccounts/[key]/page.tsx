'use client';

import { SubAccountDetailPage } from '@/components/subaccount-detail';

// Mirrors the Studio settings sub-account detail (same component + browser
// basePath); served under the App shell on the App host.
export default function Page() {
  return <SubAccountDetailPage basePath="/settings/subaccounts" />;
}
