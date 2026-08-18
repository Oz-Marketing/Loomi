'use client';

import { AdminOnly } from '@/components/route-guard';
import { AccountsList } from '@/components/accounts-list';

export default function AccountsPage() {
  return (
    <AdminOnly>
      <div>
        <div className="page-sticky-header mb-8">
          <h2 className="text-2xl font-bold">Accounts</h2>
        </div>
        <AccountsList listPath="/subaccounts" detailBasePath="/subaccounts" />
      </div>
    </AdminOnly>
  );
}
