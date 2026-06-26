import { Suspense } from 'react';
import { AdminOnly } from '@/components/route-guard';
import { CampaignBuilderNew } from '@/components/campaigns/builder/CampaignBuilderNew';

export default function NewCampaignPage() {
  return (
    <AdminOnly>
      <Suspense fallback={null}>
        <CampaignBuilderNew />
      </Suspense>
    </AdminOnly>
  );
}
