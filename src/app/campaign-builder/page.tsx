import { CampaignViewers } from '@/components/route-guard';
import { CampaignList } from '@/components/campaigns/builder/CampaignList';

export default function CampaignBuilderPage() {
  return (
    <CampaignViewers>
      <CampaignList />
    </CampaignViewers>
  );
}
