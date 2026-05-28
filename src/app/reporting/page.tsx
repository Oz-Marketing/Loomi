'use client';

/**
 * Reporting dashboard — the canonical home for analytics across
 * Loomi. Renders the full role-aware dashboard that used to live on
 * studio's `/dashboard` (now relocated here because the studio
 * dashboard was entirely analytical).
 *
 * Role dispatch happens inside `RoleDashboard`:
 *   - client → ClientRoleDashboard (scoped to their assigned accounts)
 *   - admin / dev / super_admin → ManagementRoleDashboard
 */
import { RoleDashboard } from '@/components/dashboards/role-dashboard';

export default function ReportingDashboardPage() {
  return <RoleDashboard />;
}
