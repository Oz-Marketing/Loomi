import { AdminOnly } from '@/components/route-guard';
import { ManualCampaignWizard } from '@/components/campaigns/builder/ManualCampaignWizard';

export default function ManualCampaignPage() {
  return (
    <AdminOnly>
      <ManualCampaignWizard />
    </AdminOnly>
  );
}
