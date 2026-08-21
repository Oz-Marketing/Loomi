import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions/require';
import { playbooksAllowed } from '@/lib/playbooks/access';
import { CHECKS_BY_ID } from '@/lib/playbooks/checks';

/**
 * Waive a check on one account — "this is not a question here" (docs/playbooks.md §4.3).
 *
 * Phase 0 INFERS which playbooks apply, so the audit is wrong in both
 * directions: a rooftop that deliberately doesn't run a channel still reads as
 * missing it, and `budget.managed` is red almost everywhere on purpose. Without
 * somewhere to put that judgement, the only way to act on a false red is to
 * ignore it — and a screen people have learned to ignore is worth nothing.
 *
 * Guarded on `agency.subaccounts.edit` WITH the account key, not on a
 * platform-wide permission: a waiver is a statement about one rooftop's setup,
 * and someone restricted to three accounts should be able to make it for those
 * three and no others. Reading is folded into the audit payload, so there is no
 * GET here.
 */

/** Free text a person will read months from now. Long enough to explain, bounded. */
const MAX_REASON = 500;

export async function POST(req: NextRequest) {
  let body: { accountKey?: string; checkId?: string; reason?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const accountKey = (body.accountKey ?? '').trim();
  const checkId = (body.checkId ?? '').trim();
  const reason = (body.reason ?? '').trim();

  if (!accountKey || !checkId) {
    return NextResponse.json({ error: 'accountKey and checkId are required' }, { status: 400 });
  }
  // A waiver with no reason is how a real red gets buried — the next person to
  // read the row cannot tell a considered exemption from a shrug. So this is a
  // 400, not a default.
  if (!reason) {
    return NextResponse.json(
      { error: 'A reason is required — a waiver without one is indistinguishable from ignoring it.' },
      { status: 400 },
    );
  }
  if (reason.length > MAX_REASON) {
    return NextResponse.json(
      { error: `Keep the reason under ${MAX_REASON} characters.` },
      { status: 400 },
    );
  }
  // Refuse an unknown check id rather than storing a waiver that can never
  // match anything. Checks are code constants, so this is knowable here.
  if (!CHECKS_BY_ID.has(checkId)) {
    return NextResponse.json({ error: `Unknown check: ${checkId}` }, { status: 400 });
  }

  const { session, error } = await requirePermission('agency.subaccounts.edit', { accountKey });
  if (error) return error;
  if (!(await playbooksAllowed())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    // The account has to exist: a waiver on a typo'd key is invisible forever.
    const account = await prisma.account.findUnique({
      where: { key: accountKey },
      select: { key: true },
    });
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const waiver = await prisma.playbookCheckWaiver.upsert({
      where: { accountKey_checkId: { accountKey, checkId } },
      // Re-waiving replaces the reason and re-stamps the author, so the row
      // always reflects the most recent judgement rather than the first one.
      update: { reason, waivedByUserId: session!.user.id ?? null },
      create: { accountKey, checkId, reason, waivedByUserId: session!.user.id ?? null },
      select: { checkId: true, reason: true, createdAt: true, updatedAt: true },
    });
    return NextResponse.json({ waiver });
  } catch (err) {
    console.error('[api/playbooks/waivers] POST failed:', err);
    return NextResponse.json({ error: 'Could not save the waiver' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const accountKey = (req.nextUrl.searchParams.get('accountKey') ?? '').trim();
  const checkId = (req.nextUrl.searchParams.get('checkId') ?? '').trim();
  if (!accountKey || !checkId) {
    return NextResponse.json({ error: 'accountKey and checkId are required' }, { status: 400 });
  }

  const { error } = await requirePermission('agency.subaccounts.edit', { accountKey });
  if (error) return error;
  if (!(await playbooksAllowed())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    // deleteMany, not delete: lifting a waiver that is already gone is the
    // outcome the caller wanted, not a 500.
    const { count } = await prisma.playbookCheckWaiver.deleteMany({
      where: { accountKey, checkId },
    });
    return NextResponse.json({ ok: true, removed: count });
  } catch (err) {
    console.error('[api/playbooks/waivers] DELETE failed:', err);
    return NextResponse.json({ error: 'Could not lift the waiver' }, { status: 500 });
  }
}
