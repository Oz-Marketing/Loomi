import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { preflightEmailBlast } from '@/lib/sending/blast-preflight';
import { getEmailBlast, resendSubjectToCheck } from '@/lib/services/email-blasts';
import { canReadBlast, canUseAccount } from '@/lib/messaging/blast-access';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/blasts/email/[id]/preflight
 *
 * Read-only deliverability + compliance report for a draft.
 *
 * The Schedule step calls this on load so a misconfigured account surfaces
 * BEFORE someone fills in a send time and hits the button — the POST
 * /schedule gate runs the same checks and would otherwise reject at the last
 * possible moment. Same checks, two moments; this one is advisory.
 *
 * `?accountKey=` lets the caller preflight a specific sub-account before the
 * blast's own accountKeys have been stamped (they're only written when the
 * draft is scheduled), which is the normal case for a first-time send.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission(['studio.email.edit']);
  if (error) return error;

  const { id } = await params;
  const blast = await getEmailBlast(id);
  // Account-scoped admins used to pass this check (only clients were held to
  // their accounts), and so could read another account's sending setup.
  if (!blast || !canReadBlast(session!.user, blast.accountKeys)) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const override = (req.nextUrl.searchParams.get('accountKey') || '').trim();
  // The override names an account outright, so it is checked against the
  // caller's scope on its own — any key used to be accepted, which exposed
  // that account's sender, footer and domain status to anyone with the id of
  // some blast they could see.
  if (override && !canUseAccount(session!.user, override)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const accountKeys = override ? [override] : blast.accountKeys;

  // Nothing to check against yet — the caller hasn't picked an account and the
  // draft has none stamped. Report "not ready" without inventing issues.
  if (accountKeys.length === 0) {
    return NextResponse.json({ ok: false, issues: [], pending: true });
  }

  const result = await preflightEmailBlast({
    subject: blast.subject || '',
    htmlContent: blast.htmlContent || '',
    textContent: blast.textContent,
    previewText: blast.previewText,
    resendSubject: resendSubjectToCheck(blast.metadata),
    accountKeys,
  });

  return NextResponse.json({ ok: result.ok, issues: result.issues, pending: false });
}
