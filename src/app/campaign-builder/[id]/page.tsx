import { AdminOnly } from '@/components/route-guard';
import { CampaignOverview } from '@/components/campaigns/builder/CampaignOverview';

export default async function CampaignOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminOnly>
      <CampaignOverview campaignId={id} />
    </AdminOnly>
  );
}
