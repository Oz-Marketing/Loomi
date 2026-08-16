import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import {
  listSmsBlasts,
  type BlastStatusFilter,
} from '@/lib/services/sms-blasts';

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
  const accountKeys = session!.user.role === 'client'
    ? (session!.user.accountKeys ?? [])
    : undefined;

  const campaigns = await listSmsBlasts({ limit, accountKeys, statusFilter });
  return NextResponse.json({ campaigns });
}

function parseCampaignStatusFilter(
  value: string | null,
): BlastStatusFilter | undefined {
  if (value === 'all' || value === 'archived') return value;
  return undefined;
}
