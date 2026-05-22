import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { listSmsCampaigns } from '@/lib/services/sms-campaigns';

/**
 * GET /api/campaigns/sms?limit=20
 *
 * Lists recent SMS campaigns created in Loomi. Mirrors the
 * /api/campaigns/email list endpoint so dashboards can fetch both
 * channels with the same shape.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin', 'client');
  if (error) return error;

  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || '20');
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 20;
  const accountKeys = session!.user.role === 'client'
    ? (session!.user.accountKeys ?? [])
    : undefined;

  const campaigns = await listSmsCampaigns({ limit, accountKeys });
  return NextResponse.json({ campaigns });
}
