/**
 * Bulk actions on ad creatives — /api/ad-generator/creatives/bulk
 *
 * One round trip for a multi-selection, rather than N calls from the client.
 * That matters beyond latency: a per-row loop that fails halfway leaves the
 * list in a state neither the user nor the UI can describe, whereas these run
 * as a single scoped `updateMany`/`deleteMany`.
 *
 * Every action re-derives which of the submitted ids the caller may actually
 * touch and operates on THAT set — the id list is client-supplied, so it can
 * name rows from another sub-account.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope, canAccessAccount, forbidden } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = ['archive', 'restore', 'delete', 'mark_ready', 'mark_draft'] as const;
type Action = (typeof ACTIONS)[number];

/** Guard against an unbounded id list turning one request into a table scan. */
const MAX_IDS = 500;

export async function POST(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { ids?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((x): x is string => typeof x === 'string' && !!x.trim()))]
    : [];
  const action = body.action as Action;
  if (!ids.length) return NextResponse.json({ error: 'No ads selected' }, { status: 400 });
  if (ids.length > MAX_IDS) return NextResponse.json({ error: `Select at most ${MAX_IDS} ads` }, { status: 400 });
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

  // Authorise per row. A single shared accountKey can't be assumed: the client
  // could mix sub-accounts, and silently acting on the ones it may touch while
  // ignoring the rest is the only safe reading of a partially-allowed request.
  const rows = await prisma.adCreative.findMany({
    where: { id: { in: ids } },
    select: { id: true, accountKey: true },
  });
  const scope = getAccountScope(session);
  const allowed = rows.filter((r) => canAccessAccount(scope, r.accountKey)).map((r) => r.id);
  if (!allowed.length) return forbidden();

  try {
    if (action === 'delete') {
      const { count } = await prisma.adCreative.deleteMany({ where: { id: { in: allowed } } });
      return NextResponse.json({ ok: true, count, action });
    }

    const data =
      action === 'archive'
        ? { archivedAt: new Date() }
        : action === 'restore'
          ? { archivedAt: null }
          : // mark_ready / mark_draft leave archivedAt alone: an archived ad that
            // gets its status changed should stay archived.
            { status: action === 'mark_ready' ? 'ready' : 'draft' };

    const { count } = await prisma.adCreative.updateMany({ where: { id: { in: allowed } }, data });
    return NextResponse.json({ ok: true, count, action });
  } catch (err) {
    console.error('[api/ad-generator/creatives/bulk] failed:', err);
    return NextResponse.json({ error: 'Could not apply the change' }, { status: 500 });
  }
}
