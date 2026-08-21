'use client';

import { useAccount } from '@/contexts/account-context';
import { SubAccountDetailPage } from '@/components/subaccount-detail';

export default function SubAccountSettingsPage() {
  const { accountKey } = useAccount();

  return (
    <SubAccountDetailPage
      basePath="/settings/subaccounts"
      settingsMode
      accountKeyProp={accountKey || ''}
    />
  );
}
