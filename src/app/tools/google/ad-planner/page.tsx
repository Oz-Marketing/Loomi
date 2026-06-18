'use client';

import { AdminOnly } from '@/components/route-guard';
import { GoogleAdsToolShell } from '../_components/GoogleAdsToolShell';

export default function GoogleAdPlannerPage() {
  return (
    <AdminOnly>
      <GoogleAdsToolShell mode="planner" />
    </AdminOnly>
  );
}
