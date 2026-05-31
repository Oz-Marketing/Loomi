'use client';

import { AdminOnly } from '@/components/route-guard';
import { MetaAdsPlannerTool } from '../_components/MetaAdsPlannerTool';

export default function MetaAdPlannerPage() {
  return (
    <AdminOnly>
      <MetaAdsPlannerTool mode="planner" />
    </AdminOnly>
  );
}
