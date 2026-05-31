'use client';

import { AdminOnly } from '@/components/route-guard';
import { MetaAdsPlannerTool } from '../_components/MetaAdsPlannerTool';

export default function MetaAdPacerPage() {
  return (
    <AdminOnly>
      <MetaAdsPlannerTool mode="pacer" />
    </AdminOnly>
  );
}
