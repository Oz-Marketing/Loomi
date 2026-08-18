import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions/require';
import { filterAccountKeysByAccess } from '@/lib/roles';
import { playbooksAllowed } from '@/lib/playbooks/access';
import { loadAuditContexts, currentPeriod } from '@/lib/playbooks/context';
import { buildAuditPayload } from '@/lib/playbooks/audit';

/**
 * Playbook coverage audit — read-only (docs/playbooks.md §4).
 *
 * Returns the whole matrix in one payload: every sub-account the caller may
 * see, scored against every playbook that applies to it, plus the per-check
 * rollup. It's a handful of batched queries and a few hundred pure functions,
 * so there's no pagination to design around.
 */
export async function GET() {
  // The audit enumerates every sub-account's configuration, so it reads as a
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
    const allowed = filterAccountKeysByAccess(
      all.map((a) => a.key),
      session!.user.role,
      session!.user.accountKeys ?? [],
    );

    const now = new Date();
    const contexts = await loadAuditContexts(allowed, { now });
    return NextResponse.json(
      buildAuditPayload(contexts, { period: currentPeriod(now), generatedAt: now }),
    );
  } catch (err) {
    console.error('[api/playbooks/audit] GET failed:', err);
    return NextResponse.json({ error: 'Could not run the audit' }, { status: 500 });
  }
}
