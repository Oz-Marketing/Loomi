import { CampaignViewers } from '@/components/route-guard';
import { CampaignList } from '@/components/campaigns/builder/CampaignList';

export default function SubaccountCampaignBuilderPage() {
  return (
    <CampaignViewers>
      <CampaignList />
    </CampaignViewers>
  );
}
