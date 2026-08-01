import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as projects from '@/lib/services/projects';
import { isBudgetChannel } from '@/lib/budget/channels';
import { isValidPeriod } from '@/lib/services/budget';
import type { BudgetEntry } from '@/lib/projects/ui';

/**
 * POST /api/projects/intake — file a ticket. Creates (or attaches to) an
 * initiative for the account and spins up one task per selected team, firing
 * assignment / team notifications, and records any requested media budget as
 * BudgetLines (docs/budget-module.md). Internal-staff only.
 */

/**
 * Validate the per-department budget rows. Unknown channels and non-positive
 * amounts are DROPPED rather than rejected: a malformed row shouldn't cost the
 * rep the whole ticket, and the hub surfaces any money that didn't land.
 */
function parseBudgetEntries(raw: unknown): BudgetEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: BudgetEntry[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const { channel, amount } = r as { channel?: unknown; amount?: unknown };
    if (typeof channel !== 'string' || !isBudgetChannel(channel)) continue;
    const n = typeof amount === 'number' ? amount : Number(amount);
    if (!Number.isFinite(n) || n <= 0) continue;
    out.push({ channel, amount: n });
  }
  return out;
}
export async function POST(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const scope = getAccountScope(session!);
  const body = await req.json().catch(() => ({}));

  const accountKeys: string[] = Array.isArray(body.accountKeys)
    ? body.accountKeys.map(String).filter(Boolean)
    : [];
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  // Per-department type entries: [{ teamKey, kind, details, budget }].
  type RawDept = {
    teamKey: string;
    kind?: string;
    details?: unknown;
    budget?: unknown;
  };
  const departments: {
    teamKey: string;
    kind: string;
    details?: Record<string, unknown>;
    budget?: BudgetEntry[];
  }[] = Array.isArray(body.departments)
    ? body.departments
        .filter(
          (d: unknown): d is RawDept =>
            !!d && typeof (d as { teamKey?: unknown }).teamKey === 'string',
        )
        .map((d: RawDept) => ({
          teamKey: d.teamKey,
          kind: typeof d.kind === 'string' ? d.kind : 'generic',
          details:
            d.details && typeof d.details === 'object'
              ? (d.details as Record<string, unknown>)
              : undefined,
          budget: parseBudgetEntries(d.budget),
        }))
    : [];

  const meta =
    body.meta && typeof body.meta === 'object' ? (body.meta as Record<string, unknown>) : null;
  const billing =
    body.billing && typeof body.billing === 'object'
      ? (body.billing as Record<string, unknown>)
      : null;

  if (accountKeys.length === 0 || !title) {
    return NextResponse.json({ error: 'accountKeys and title are required' }, { status: 400 });
  }
  // Caller must be able to access every selected dealer.
  if (!accountKeys.every((k) => projects.canAccess(scope, k))) return forbidden();

  const result = await projects.createTicket(
    {
      accountKeys,
      initiativeId: body.initiativeId ?? null,
      initiativeName: body.initiativeName ?? null,
      createInitiative: body.createInitiative === true,
      templateKey: body.templateKey ?? null,
      departments,
      creativeMode: body.creativeMode === 'shared' ? 'shared' : 'unique',
      title,
      description: typeof body.description === 'string' ? body.description : null,
      priority: typeof body.priority === 'string' ? body.priority : undefined,
      dueDate: body.dueDate ?? null,
      assigneeUserId: body.assigneeUserId ?? null,
      budgetPeriod:
        typeof body.budgetPeriod === 'string' && isValidPeriod(body.budgetPeriod)
          ? body.budgetPeriod
          : null,
      meta,
      billing,
    },
    session!.user.id,
  );

  return NextResponse.json(result, { status: 201 });
}
