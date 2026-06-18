import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { ELEVATED_ROLES } from '@/lib/roles';
import { updateAlertRule, type AlertRulePatch } from '@/lib/services/alert-rules';

/**
 * PUT /api/alert-rules/[id] — tune one alert rule (elevated only). Accepts the
 * admin-editable subset (enabled, tier, cooldownHours, minVolumeGate,
 * fireCondition, baselineParams, name/description). Validation lives in the
 * service; a bad value comes back as 400.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireRole(...ELEVATED_ROLES);
  if (error) return error;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as AlertRulePatch;

  try {
    const rule = await updateAlertRule(id, body);
    return NextResponse.json({ rule });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not update alert rule.';
    // Prisma "record not found" → 404; validation errors → 400.
    const status = /not found|no.*record|RecordNotFound/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
