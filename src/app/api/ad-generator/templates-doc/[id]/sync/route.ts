/**
 * Push a template's saved design into ads built from it —
 * POST /api/ad-generator/templates-doc/[id]/sync
 *
 * Body: `{ ids: string[] }` — the ads to update, as chosen in the save-time
 * prompt. Returns `{ runId }`; poll GET on this route to follow it.
 *
 * ── Why this enqueues instead of doing the work ──
 *
 * It used to do the work, and it returned 504. Every ad is re-preflighted and
 * re-rendered, and rendering is Chromium plus an upload — hundreds of
 * milliseconds at best, seconds while a remote vehicle photo loads. Production
 * nginx sets no `proxy_read_timeout`, so an upstream request dies at its
 * 60-second default. The old route declared `maxDuration = 300` (a Vercel
 * setting, inert on the droplet) and the dialog split itself into 10-ad requests
 * to "stay inside the timeout", but a 9-size template used by 214 ads is 1,926
 * renders and no batch size makes that fit.
 *
 * So the request does only what a request can: authorize the ads, freeze the
 * design, create the run, hand back its id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope, canAccessAccount } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import { enqueueTemplateSyncJob } from '@/lib/ad-generator/template-sync-job';
import type { ApplyResult } from '@/lib/ad-generator/template-sync-apply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Per request. Not a timeout budget any more — the worker has no clock — but a
 * bound on how much one dialog can commit in a single press, and it matches the
 * `take: 500` the impact query uses to build the list in the first place.
 */
const MAX_IDS = 500;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requirePermission('studio.adgen.edit');
  if (error) return error;
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((x): x is string => typeof x === 'string' && !!x.trim()))]
    : [];
  if (!ids.length) return NextResponse.json({ error: 'No ads to update' }, { status: 400 });
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `Send at most ${MAX_IDS} ads per request` }, { status: 400 });
  }

  const template = await prisma.adTemplateDoc.findUnique({ where: { id }, select: { doc: true } }).catch(() => null);
  if (!template?.doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let doc: TemplateDoc;
  try {
    doc = JSON.parse(template.doc) as TemplateDoc;
  } catch {
    return NextResponse.json({ error: 'That template could not be read' }, { status: 500 });
  }
  if (!Array.isArray(doc.sizes) || !Array.isArray(doc.elements) || !doc.layouts) {
    return NextResponse.json({ error: 'That template is not a usable design' }, { status: 500 });
  }

  // Re-derive which of the submitted ids the caller may actually touch, and
  // operate on THAT set: the list is client-supplied, so it can name ads from
  // another account, and it can name ads built from a different template.
  //
  // This has to happen HERE and not in the worker: the worker has no session, so
  // the run row is the record of an already-authorized decision.
  const scope = getAccountScope(session);
  const rows = await prisma.adCreative
    .findMany({ where: { id: { in: ids }, templateId: id }, select: { id: true, accountKey: true } })
    .catch(() => []);
  const allowedRows = rows.filter((r) => canAccessAccount(scope, r.accountKey));
  const allowed = allowedRows.map((r) => r.id);
  if (!allowed.length) return NextResponse.json({ error: 'No ads to update' }, { status: 400 });

  // One account, or null for a run that spans several. Null is meaningful here:
  // it says "don't gate reads on a single account", which is why the GET below
  // falls back to "did you start this run" rather than treating null as open.
  const keys = new Set(allowedRows.map((r) => r.accountKey));
  const runAccountKey = keys.size === 1 ? [...keys][0] : null;

  let run: { id: string };
  try {
    run = await prisma.adTemplateSyncRun.create({
      data: {
        templateId: id,
        accountKey: runAccountKey,
        startedByUserId: session.user.id,
        status: 'queued',
        total: allowed.length,
        creativeIds: JSON.stringify(allowed),
        // Frozen here, so the worker applies the design the person approved
        // rather than whatever the builder has autosaved since.
        doc: JSON.stringify(doc),
      },
      select: { id: true },
    });
  } catch (err) {
    console.error('[api/ad-generator/templates-doc/[id]/sync] could not create run:', err);
    return NextResponse.json({ error: 'Could not start the update' }, { status: 500 });
  }

  try {
    await enqueueTemplateSyncJob(run.id);
  } catch (err) {
    // Mark it failed rather than leaving a `queued` row nothing will ever pick
    // up — from the dialog's side that is indistinguishable from a slow run, so
    // it would spin forever.
    await prisma.adTemplateSyncRun
      .update({
        where: { id: run.id },
        data: {
          status: 'failed',
          error: 'Could not reach the background worker to start this update.',
          finishedAt: new Date(),
        },
      })
      .catch(() => {});
    console.error('[api/ad-generator/templates-doc/[id]/sync] enqueue failed:', err);
    return NextResponse.json({ error: 'Could not start the update' }, { status: 503 });
  }

  return NextResponse.json({ runId: run.id, total: allowed.length, queued: true });
}

export interface SyncRunStatus {
  runId: string;
  status: string;
  total: number;
  processed: number;
  updated: number;
  blocked: number;
  failed: number;
  skipped: number;
  results: ApplyResult[];
  error: string | null;
  /**
   * This run is not moving, and the reason is almost certainly the worker.
   *
   * Two shapes, one flag: nothing ever picked the run up, or the worker died
   * partway and left the row mid-flight. Both look exactly like slow progress
   * from the outside, which is the whole problem — a crash-looping worker is a
   * documented recurring failure here (see CLAUDE.md), and without this the
   * dialog would poll a dead run forever.
   */
  stalled: boolean;
  finishedAt: string | null;
}

/** Follow a run: GET /api/ad-generator/templates-doc/[id]/sync?runId=… */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requirePermission('studio.adgen.edit');
  if (error) return error;
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const runId = req.nextUrl.searchParams.get('runId');
  if (!runId) return NextResponse.json({ error: 'A runId is required' }, { status: 400 });

  const run = await prisma.adTemplateSyncRun.findUnique({ where: { id: runId } }).catch(() => null);
  // Scoped to the template in the path as well as the id, so a guessed runId
  // can't be read through some other template's route.
  if (!run || run.templateId !== id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  // Whoever started it can always follow it. Otherwise the run has to sit in a
  // single account this caller can reach — a cross-account run stores no key, so
  // without the first clause it would be readable by anyone with adgen.edit.
  const scope = getAccountScope(session);
  const isOwner = !!run.startedByUserId && run.startedByUserId === session.user.id;
  if (!isOwner && !(run.accountKey && canAccessAccount(scope, run.accountKey))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let results: ApplyResult[] = [];
  try {
    const parsed = run.results ? JSON.parse(run.results) : [];
    if (Array.isArray(parsed)) results = parsed as ApplyResult[];
  } catch {
    results = [];
  }

  // Nothing has claimed the job. The worker polls continuously, so a minute is
  // already far outside normal.
  const QUEUED_GRACE_MS = 60_000;
  // Claimed, but no progress written. One ad is a render and an upload, so a few
  // seconds each; five minutes of silence means the process is gone, not busy.
  const PROGRESS_GRACE_MS = 300_000;
  const sinceProgress = Date.now() - run.updatedAt.getTime();
  const stalled =
    (run.status === 'queued' && Date.now() - run.startedAt.getTime() > QUEUED_GRACE_MS) ||
    (run.status === 'running' && sinceProgress > PROGRESS_GRACE_MS);

  const payload: SyncRunStatus = {
    runId: run.id,
    status: run.status,
    total: run.total,
    processed: run.processed,
    updated: run.updated,
    blocked: run.blocked,
    failed: run.failedAds,
    skipped: run.skipped,
    results,
    error: run.error,
    stalled,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
  };
  return NextResponse.json(payload);
}
