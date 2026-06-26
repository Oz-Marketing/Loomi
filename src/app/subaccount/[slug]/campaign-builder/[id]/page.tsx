import { AdminOnly } from '@/components/route-guard';
import { CampaignOverview } from '@/components/campaigns/builder/CampaignOverview';

export default async function SubaccountCampaignOverviewPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminOnly>
      <CampaignOverview campaignId={id} />
    </AdminOnly>
  );
}
