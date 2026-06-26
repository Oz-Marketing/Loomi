import { AdminOnly } from '@/components/route-guard';
import { CampaignList } from '@/components/campaigns/builder/CampaignList';

export default function SubaccountCampaignBuilderPage() {
  return (
    <AdminOnly>
      <CampaignList />
    </AdminOnly>
  );
}
