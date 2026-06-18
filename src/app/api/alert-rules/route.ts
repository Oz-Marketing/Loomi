import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/roles';
import { listAlertRules } from '@/lib/services/alert-rules';

/**
 * §9 alert-rule config rows. GET — management-tier reads the list for the
 * Settings → Alerts tab. Rows are seeded (scripts/backfill-alert-rules.ts) and
 * tuned via PUT /api/alert-rules/[id]; there's no create/delete in v1 because
 * the evaluable metrics are fixed (account pace, budget burn).
 */
export async function GET() {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    return NextResponse.json({ rules: await listAlertRules() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not load alert rules.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
