import { AdminOnly } from '@/components/route-guard';
import { ManualCampaignWizard } from '@/components/campaigns/builder/ManualCampaignWizard';

export default function SubaccountManualCampaignPage() {
  return (
    <AdminOnly>
      <ManualCampaignWizard />
    </AdminOnly>
  );
}
