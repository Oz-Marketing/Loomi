'use client';

import { AdminOnly } from '@/components/route-guard';
import { MetaAdsPlannerTool } from './_components/MetaAdsPlannerTool';

// Consolidated Meta Ads page — Planner + Pacer in one surface, switched by an
// in-page Plan/Pace toggle. The tool reads `?view=planner|pacer` to pick the
// initial mode (defaults to planner) and mirrors the toggle back to the URL.
export default function MetaAdsPage() {
  return (
    <AdminOnly>
      <MetaAdsPlannerTool mode="planner" />
    </AdminOnly>
  );
}
