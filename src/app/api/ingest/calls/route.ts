import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ingestCalls, type IngestCallInput } from '@/lib/contacts/ingest-calls';
import { recordIngestRun } from '@/lib/contacts/ingest-runs';

// POST /api/ingest/calls
//
// Machine-to-machine ingestion of tracked phone calls, pushed by Oz Reports'
// `/loomi/pushcalls`. Same Bearer secret (OZ_INGEST_SECRET) as the contacts and
// events routes. Idempotent on each call's idempotencyKey, so the Sunday
// full-history sweep is re-runnable.
//
// Body: { accountKey, calls: [ { idempotencyKey, occurredAt, status,
//         durationSeconds, trackerName, callerCity, callerState, callerZip } ] }
//
// Note what is NOT accepted: caller name, caller phone number, recording URL.
// The report needs none of them and the model does not carry them — see the
// CallEvent comment in schema.prisma. Extra keys in a call object are ignored
// rather than rejected, so an upstream change can't break the sync, but they
// are not stored either.

const MAX_CALLS_PER_REQUEST = 2000;

function timingSafeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function presentedSecret(req: NextRequest): string {
  const header = req.headers.get('x-oz-ingest-secret')?.trim() || '';
  if (header) return header;
  const auth = req.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice('bearer '.length).trim();
  return '';
}

export async function POST(req: NextRequest) {
  const expected = (process.env.OZ_INGEST_SECRET || '').trim();
  if (!expected) {
    return NextResponse.json({ error: 'OZ_INGEST_SECRET is not configured' }, { status: 500 });
  }
  const presented = presentedSecret(req);
  if (!presented || !timingSafeCompare(presented, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim() : '';
  if (!accountKey) {
    return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  }

  const calls = body.calls;
  if (!Array.isArray(calls)) {
    return NextResponse.json({ error: 'calls must be an array' }, { status: 400 });
  }
  if (calls.length > MAX_CALLS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Batch exceeds ${MAX_CALLS_PER_REQUEST} calls; split into smaller requests` },
      { status: 413 },
    );
  }

  // Before the empty-batch branch: a typo'd accountKey must still 404, and the
  // heartbeat below needs a valid FK.
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true },
  });
  if (!account) {
    return NextResponse.json({ error: `Unknown accountKey: ${accountKey}` }, { status: 404 });
  }

  const batchSource =
    typeof body.source === 'string' && body.source.trim() ? body.source.trim() : null;

  // Empty batches still write a heartbeat — absence of runs must mean absence
  // of runs, not "the sync ran and there was nothing new".
  if (calls.length === 0) {
    await recordIngestRun({
      accountKey,
      kind: 'calls',
      source: batchSource,
      totalRows: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      issueCount: 0,
    });
    return NextResponse.json({ totalRows: 0, created: 0, updated: 0, skipped: 0, issues: [] });
  }

  const summary = await ingestCalls({ accountKey, calls: calls as IngestCallInput[] });

  console.log(
    `[ingest:calls] account=${accountKey} received=${summary.totalRows} ` +
      `created=${summary.created} updated=${summary.updated} skipped=${summary.skipped}`,
  );

  await recordIngestRun({
    accountKey,
    kind: 'calls',
    source: batchSource,
    totalRows: summary.totalRows,
    created: summary.created,
    updated: summary.updated,
    skipped: summary.skipped,
    issueCount: summary.issues.length,
  });

  return NextResponse.json(summary);
}
