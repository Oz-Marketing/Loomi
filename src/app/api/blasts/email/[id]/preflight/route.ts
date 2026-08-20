import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import {
  checkTextPart,
  preflightEmailBlast,
} from '@/lib/sending/blast-preflight';
import { getEmailBlast } from '@/lib/services/email-blasts';

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
  if (!blast) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  if (session!.user.role === 'client') {
    const allowed = new Set(session!.user.accountKeys ?? []);
    if (!blast.accountKeys.some((key) => allowed.has(key))) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
  }

  const override = (req.nextUrl.searchParams.get('accountKey') || '').trim();
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
    accountKeys,
  });

  const textIssue = checkTextPart(blast.htmlContent || '', blast.textContent);
  const issues = textIssue ? [...result.issues, textIssue] : result.issues;

  return NextResponse.json({ ok: result.ok, issues, pending: false });
}
