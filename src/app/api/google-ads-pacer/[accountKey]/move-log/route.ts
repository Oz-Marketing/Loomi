import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { canAccessPacer, getOrCreatePlan, isValidPeriod } from '@/lib/meta-ads-pacer';
import { newAuditGroupId, writeAudit } from '@/lib/meta-ads-audit';

/**
 * Record a completed reallocation (delivery/reallocation spec §9).
 *
 * WHY THIS EXISTS SEPARATELY FROM THE SAVE. Autosave already writes an
 * `allocation` diff for each line a move touched, but those entries are
 * independent facts: nothing in them says the two changes were one transaction,
 * which side gave and which received, or that it was a move at all rather than
 * two hand edits a few seconds apart. With several people touching budgets and
 * reconciliation reading the result downstream, "who moved what, from where, to
 * where" has to survive as one linked record. Undo is a session convenience; it
 * is not the record.
 *
 * Amounts come from the client because the move itself does — the dialog's
 * preview IS the plan that was committed. Names and ad membership are resolved
 * from the database instead of trusted, so a stale or hostile payload cannot
 * write a trail entry naming a campaign that isn't on this plan.
 */
interface MoveLogAllocation {
  id: string;
  amount: number;
}

interface MoveLogBody {
  period?: string;
  /** Null for the "Unallocated" source — a leftover, not a campaign. */
  sourceId?: string | null;
  total?: number;
  allocations?: MoveLogAllocation[];
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ accountKey: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { accountKey } = await params;
  if (!canAccessPacer(session, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const body = (await req.json()) as MoveLogBody;
  const period = body.period;
  if (!period || !isValidPeriod(period)) {
    return NextResponse.json(
      { error: 'Missing or invalid period (expected YYYY-MM)' },
      { status: 400 },
    );
  }

  const allocations = (Array.isArray(body.allocations) ? body.allocations : []).filter(
    (a) => a && typeof a.id === 'string' && Number.isFinite(Number(a.amount)),
  );
  if (allocations.length === 0) {
    return NextResponse.json({ error: 'No allocations to log' }, { status: 400 });
  }

  const plan = await getOrCreatePlan(accountKey);
  // Resolve every id against THIS plan/period/platform. Ids that don't belong
  // are dropped rather than logged under a name the client supplied.
  const ids = [...allocations.map((a) => a.id), ...(body.sourceId ? [body.sourceId] : [])];
  const ads = await prisma.metaAdsPacerAd.findMany({
    where: { id: { in: ids }, planId: plan.id, period, platform: 'google' },
    select: { id: true, name: true },
  });
  const nameById = new Map(ads.map((a) => [a.id, a.name]));

  const sourceName = body.sourceId ? nameById.get(body.sourceId) : 'Unallocated';
  if (!sourceName) {
    return NextResponse.json({ error: 'Unknown source campaign' }, { status: 400 });
  }

  const total = Number(body.total);
  const groupId = newAuditGroupId();
  const authorUserId = session.user?.id ?? null;
  const money = (n: number) => `$${n.toFixed(2)}`;

  // One entry per destination, plus one on the source. Both sides carry the
  // group id, so the trail can be read as a single move from either campaign's
  // history — which is how anyone actually looks for it ("why did Used Cars go
  // up?" starts at Used Cars, not at a global log).
  const entries = allocations
    .filter((a) => nameById.has(a.id))
    .map((a) => ({
      accountKey,
      planId: plan.id,
      period,
      platform: 'google',
      adId: a.id,
      adName: nameById.get(a.id) ?? null,
      action: 'move',
      field: 'allocation',
      fromValue: sourceName,
      toValue: nameById.get(a.id) ?? null,
      summary: `Moved ${money(Number(a.amount))} from ${sourceName} to ${nameById.get(a.id)}`,
      groupId,
      authorUserId,
    }));

  if (entries.length === 0) {
    return NextResponse.json({ error: 'No allocations matched this plan' }, { status: 400 });
  }

  if (body.sourceId) {
    entries.push({
      accountKey,
      planId: plan.id,
      period,
      platform: 'google',
      adId: body.sourceId,
      adName: sourceName,
      action: 'move',
      field: 'allocation',
      fromValue: sourceName,
      toValue: entries.map((e) => e.adName).join(', '),
      summary: `Moved ${money(Number.isFinite(total) ? total : 0)} from ${sourceName} across ${entries.length} campaign${entries.length === 1 ? '' : 's'}`,
      groupId,
      authorUserId,
    });
  }

  await writeAudit(entries);
  return NextResponse.json({ ok: true, groupId, logged: entries.length });
}
