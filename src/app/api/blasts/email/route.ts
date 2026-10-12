import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import {
  listEmailBlasts,
  type BlastStatusFilter,
} from '@/lib/services/email-blasts';
import { confinedAccountKeys } from '@/lib/messaging/blast-access';

// There is deliberately no POST here. It used to create a blast from a
// recipient list in the request body and send it inside the request — no
// preflight (sender, CAN-SPAM footer, audience quality), no worker, a
// browser-supplied audience, and a scheduled send that skipped the
// `blast.send` check entirely. Nothing in the app called it. Every blast now
// goes draft → Recipients → Message → Schedule, through
// POST /api/blasts/{email,sms,multi}/[id]/schedule. Removed 2026-10-12.

function parseCampaignStatusFilter(
  value: string | null,
): BlastStatusFilter | undefined {
  if (value === 'all' || value === 'archived') return value;
  return undefined;
}

/**
 * GET /api/blasts/email
 *
 * Lists recent email campaigns created in Loomi.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requirePermission(['studio.email.view', 'reporting.report.view']);
  if (error) return error;

  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || '20');
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 20;
  const statusFilter = parseCampaignStatusFilter(
    req.nextUrl.searchParams.get('status'),
  );
  // Clients AND account-scoped admins see only their accounts' blasts. Only
  // clients used to be filtered, so a scoped admin listed every account's.
  const confined = confinedAccountKeys(session!.user);
  // listEmailBlasts reads an empty list as "no filter" — everything. A
  // confined user with no accounts must get nothing instead.
  if (confined !== null && confined.length === 0) {
    return NextResponse.json({ campaigns: [] });
  }

  const campaigns = await listEmailBlasts({
    limit,
    accountKeys: confined ?? undefined,
    statusFilter,
  });
  return NextResponse.json({ campaigns });
}
