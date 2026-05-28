'use client';

import { AdminOnly } from '@/components/route-guard';
import { MetaAdsPlannerTool } from '../_components/MetaAdsPlannerTool';
import { ViewAnalyticsLink } from '@/components/view-analytics-link';

export default function MetaAdPacerPage() {
  return (
    <AdminOnly>
      <div className="flex justify-end mb-4">
        <ViewAnalyticsLink area="ads" />
      </div>
      <MetaAdsPlannerTool mode="pacer" />
    </AdminOnly>
  );
}
