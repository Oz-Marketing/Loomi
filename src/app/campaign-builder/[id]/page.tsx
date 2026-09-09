import { CampaignViewers } from '@/components/route-guard';
import { CampaignOverview } from '@/components/campaigns/builder/CampaignOverview';

export default async function CampaignOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <CampaignViewers>
      <CampaignOverview campaignId={id} />
    </CampaignViewers>
  );
}
