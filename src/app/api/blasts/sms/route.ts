import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import {
  listSmsBlasts,
  type BlastStatusFilter,
} from '@/lib/services/sms-blasts';
import { confinedAccountKeys } from '@/lib/messaging/blast-access';

/**
 * GET /api/blasts/sms?limit=20&status=all|archived
 *
 * Lists recent SMS campaigns created in Loomi. Mirrors the
 * /api/blasts/email list endpoint so dashboards can fetch both
 * channels with the same shape. `status` defaults to 'all' which
 * hides archived rows.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requirePermission(['studio.email.view', 'reporting.report.view']);
  if (error) return error;

  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || '20');
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 20;
  const statusFilter = parseCampaignStatusFilter(
    req.nextUrl.searchParams.get('status'),
  );
  // Clients AND account-scoped admins see only their accounts' blasts — the
  // same rule as the email list (only clients used to be filtered).
  const confined = confinedAccountKeys(session!.user);
  // listSmsBlasts reads an empty list as "no filter"; a confined user with no
  // accounts must get nothing instead.
  if (confined !== null && confined.length === 0) {
    return NextResponse.json({ campaigns: [] });
  }

  const campaigns = await listSmsBlasts({
    limit,
    accountKeys: confined ?? undefined,
    statusFilter,
  });
  return NextResponse.json({ campaigns });
}

function parseCampaignStatusFilter(
  value: string | null,
): BlastStatusFilter | undefined {
  if (value === 'all' || value === 'archived') return value;
  return undefined;
}
