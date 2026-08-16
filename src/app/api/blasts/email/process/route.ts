import { NextRequest, NextResponse } from 'next/server';
import { requireAllPermissions } from '@/lib/permissions/require';
import { recordCapabilityUse } from '@/lib/permissions/audit';
import {
  getEmailBlast,
  processDueEmailBlasts,
  processEmailBlast,
} from '@/lib/services/email-blasts';

/**
 * POST /api/blasts/email/process
 *
 * Processes either one campaign (`campaignId`) or all due campaigns.
 * Intended for optional cron/manual execution of scheduled sends.
 */
export async function POST(req: NextRequest) {
  // Staff only — this drains the send queue. Was client-reachable; closed
  // alongside POST /api/blasts/email. `blast.send` then narrows it from "any
  // staff" to the people actually cleared to put mail on the wire.
  const { session, error } = await requireAllPermissions([
    'studio.email.edit',
    'blast.send',
  ]);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const campaignId = typeof body?.campaignId === 'string' ? body.campaignId.trim() : '';
  const limitRaw = Number(body?.limit ?? 3);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(10, limitRaw)) : 3;

  if (campaignId) {
    const campaign = await getEmailBlast(campaignId);
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    if (session!.user.role === 'client') {
      const allowed = new Set(session!.user.accountKeys ?? []);
      if (!campaign.accountKeys.some((key) => allowed.has(key))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const processed = await processEmailBlast(campaignId, { concurrency: 3 });
    recordCapabilityUse(
      { id: session!.user.id, email: session!.user.email },
      'blast.send',
      `Processed email blast ${campaignId}`,
    );
    return NextResponse.json({ campaigns: [processed], processed: 1 });
  }

  const accountKeys = session!.user.role === 'client'
    ? (session!.user.accountKeys ?? [])
    : undefined;

  const campaigns = await processDueEmailBlasts({
    limit,
    accountKeys,
    concurrency: 3,
  });

  if (campaigns.length > 0) {
    recordCapabilityUse(
      { id: session!.user.id, email: session!.user.email },
      'blast.send',
      `Drained the send queue: ${campaigns.length} due campaign(s)`,
    );
  }

  return NextResponse.json({ campaigns, processed: campaigns.length });
}
