'use client';

import { useParams } from 'next/navigation';
import { SubAccountDetailPage } from '@/components/subaccount-detail';

export default function Page() {
  const params = useParams();
  const key = (params?.key as string) || '';
  // settingsMode → sidebar shows the sub-account's sections (incl. Integrations),
  // matching the Studio scoped settings experience. Account comes from the URL.
  return <SubAccountDetailPage basePath="/settings/subaccounts" settingsMode accountKeyProp={key} />;
}
