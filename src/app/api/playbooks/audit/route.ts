import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions/require';
import { playbooksAllowed } from '@/lib/playbooks/access';
import { resolveAuditScope } from '@/lib/playbooks/scope';
import { loadAuditContexts, currentPeriod } from '@/lib/playbooks/context';
import { buildAuditPayload } from '@/lib/playbooks/audit';

/**
 * Playbook coverage audit — read-only (docs/playbooks.md §4).
 *
 * Returns the matrix in one payload: each account in scope, scored against every
 * playbook that applies to it, plus the per-check rollup. It's a handful of
 * batched queries and a few hundred pure functions, so there's no pagination to
 * design around.
 *
 * SCOPE. `accountKeys` narrows the audit to the caller's current selection — one
 * account, or a group and everything under it. Omitting it means the
 * all-accounts overview (docs/account-scope.md).
 *
 * The requested keys are INTERSECTED with what the session may see, never
 * trusted. Scope is a request input; access is not. This endpoint enumerates
 * configuration for whatever it is handed, so a hand-written query must not be
 * able to reach an account the caller otherwise couldn't.
 */
export async function GET(req: NextRequest) {
  // The audit enumerates every account's configuration, so it reads as a
  // cross-rooftop admin view. `agency.subaccounts.view` maps to the `management`
  // legacy bucket, so this is the same set of roles `requireRole` allowed.
  const { session, error } = await requirePermission('agency.subaccounts.view');
  if (error) return error;
  if (!(await playbooksAllowed())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const all = await prisma.account.findMany({
      select: { key: true },
      orderBy: { dealer: 'asc' },
    });
    // The intersection lives in `scope.ts` so it can be tested without a
    // database or a session — see `scope.test.ts`.
    const inScope = resolveAuditScope({
      allAccountKeys: all.map((a) => a.key),
      role: session!.user.role,
      sessionAccountKeys: session!.user.accountKeys ?? [],
      requestedParam: req.nextUrl.searchParams.get('accountKeys'),
    });

    const now = new Date();
    // The newest sweep row, whether or not it finished: a started-and-never-
    // finished run is exactly the state worth surfacing, so this deliberately
    // does not filter on `finishedAt`.
    const [contexts, lastRun] = await Promise.all([
      loadAuditContexts(inScope, { now }),
      prisma.playbookRun.findFirst({
        where: { kind: 'sweep' },
        orderBy: { startedAt: 'desc' },
        select: {
          startedAt: true,
          finishedAt: true,
          accountsAudited: true,
          blockingFails: true,
          coveragePct: true,
          error: true,
        },
      }),
    ]);

    const payload = buildAuditPayload(contexts, {
      period: currentPeriod(now),
      generatedAt: now,
    });
    return NextResponse.json({
      ...payload,
      lastSweep: lastRun
        ? {
            startedAt: lastRun.startedAt.toISOString(),
            finishedAt: lastRun.finishedAt?.toISOString() ?? null,
            accountsAudited: lastRun.accountsAudited,
            blockingFails: lastRun.blockingFails,
            coveragePct: lastRun.coveragePct,
            error: lastRun.error,
          }
        : null,
    });
  } catch (err) {
    console.error('[api/playbooks/audit] GET failed:', err);
    return NextResponse.json({ error: 'Could not run the audit' }, { status: 500 });
  }
}
