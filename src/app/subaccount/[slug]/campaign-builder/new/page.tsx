import { Suspense } from 'react';
import { AdminOnly } from '@/components/route-guard';
import { CampaignBuilderNew } from '@/components/campaigns/builder/CampaignBuilderNew';

export default function SubaccountNewCampaignPage() {
  return (
    <AdminOnly>
      <Suspense fallback={null}>
        <CampaignBuilderNew />
      </Suspense>
    </AdminOnly>
  );
}
