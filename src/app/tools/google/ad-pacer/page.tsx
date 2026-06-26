'use client';

import { AdminOnly } from '@/components/route-guard';
import { GoogleAdsToolShell } from '../_components/GoogleAdsToolShell';

export default function GoogleAdPacerPage() {
  return (
    <AdminOnly>
      <GoogleAdsToolShell mode="pacer" />
    </AdminOnly>
  );
}
