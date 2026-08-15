import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveAccountByPlaceId } from '@/lib/integrations/google-places';
import { recordIngestRun } from '@/lib/contacts/ingest-runs';

// POST /api/ingest/reviews
//
// Published Google reviews, pushed by Oz Reports' `/loomi/pushreviews`.
// Same Bearer secret (OZ_INGEST_SECRET) as the other ingest routes.
//
// ── KEYED BY PLACE ID, NOT ACCOUNT KEY ──────────────────────────────────────
// Every other push route sends `accountKey`, because `dealer_map` carries
// `loomi_account_key` next to the dealer's other ids. The reputation database
// has no such column: Oz Dealer Tools maps a rooftop to an org through its OWN
// `organizations` table, which the Oz Reports host cannot see.
//
// Rather than add a column to `dealer_map` and ask someone to populate 38 rows
// by hand, this route inverts the lookup. The reputation DB knows each
// rooftop's Google `place_id`, and Loomi ALREADY maps account → place id
// (`GOOGLE_PLACES_MAP`, the same config the live Reputation report reads). So
// the bridge sends the place id and Loomi resolves the account with a mapping
// it already maintains — one source of truth instead of two that can drift.
//
// Body: { placeId, reviews: [ { idempotencyKey, publishedAt, stars, replied,
//         text, authorName } ] }

const MAX_REVIEWS_PER_REQUEST = 1000;

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

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
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

  const placeId = str(body.placeId);
  if (!placeId) return NextResponse.json({ error: 'Missing placeId' }, { status: 400 });

  const reviews = body.reviews;
  if (!Array.isArray(reviews)) {
    return NextResponse.json({ error: 'reviews must be an array' }, { status: 400 });
  }
  if (reviews.length > MAX_REVIEWS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Batch exceeds ${MAX_REVIEWS_PER_REQUEST} reviews; split into smaller requests` },
      { status: 413 },
    );
  }

  const resolved = resolveAccountByPlaceId(placeId);
  if (resolved.status === 'ambiguous') {
    // Two accounts claiming one listing is a config error, and guessing which
    // one owns the reviews would quietly attribute a rooftop's reputation to
    // its neighbour. Refuse and name both.
    return NextResponse.json(
      {
        error: `placeId ${placeId} is mapped to more than one account (${resolved.accountKeys.join(', ')})`,
        code: 'ambiguous_place',
      },
      { status: 409 },
    );
  }
  if (resolved.status === 'unmapped') {
    return NextResponse.json(
      {
        error: `No account is mapped to placeId ${placeId}. Add it to GOOGLE_PLACES_MAP.`,
        code: 'unmapped_place',
      },
      { status: 404 },
    );
  }
  const accountKey = resolved.accountKey;

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: `GOOGLE_PLACES_MAP points ${placeId} at unknown account ${accountKey}` },
      { status: 404 },
    );
  }

  const batchSource =
    typeof body.source === 'string' && body.source.trim() ? body.source.trim() : null;

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const issues: { index: number; reason: string }[] = [];

  for (let i = 0; i < reviews.length; i++) {
    const r = reviews[i] ?? {};
    const key = str(r.idempotencyKey);
    const publishedAt = r.publishedAt ? new Date(String(r.publishedAt)) : null;
    const stars = Math.round(Number(r.stars));

    // A star outside 1–5 would drag the average toward a value no reviewer
    // gave. Skip loudly rather than store it.
    if (!key || !publishedAt || Number.isNaN(publishedAt.getTime())) {
      skipped += 1;
      if (issues.length < 20) {
        issues.push({ index: i, reason: !key ? 'Missing idempotencyKey' : 'Invalid publishedAt' });
      }
      continue;
    }
    if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
      skipped += 1;
      if (issues.length < 20) issues.push({ index: i, reason: `Star rating out of range: ${r.stars}` });
      continue;
    }

    const data = {
      accountKey,
      publishedAt,
      stars,
      replied: r.replied === true || r.replied === 1 || r.replied === '1',
      text: str(r.text),
      authorName: str(r.authorName),
    };

    try {
      const existing = await prisma.reviewEvent.findUnique({
        where: { idempotencyKey: key },
        select: { id: true },
      });
      if (existing) {
        // Re-push matters here: a review's `replied` flips when the store
        // answers it, and that is the whole reply-rate metric.
        await prisma.reviewEvent.update({ where: { idempotencyKey: key }, data });
        updated += 1;
      } else {
        await prisma.reviewEvent.create({ data: { idempotencyKey: key, ...data } });
        created += 1;
      }
    } catch (err) {
      skipped += 1;
      if (issues.length < 20) {
        issues.push({ index: i, reason: err instanceof Error ? err.message : 'Upsert failed' });
      }
    }
  }

  console.log(
    `[ingest:reviews] place=${placeId} account=${accountKey} received=${reviews.length} ` +
      `created=${created} updated=${updated} skipped=${skipped}`,
  );

  await recordIngestRun({
    accountKey,
    kind: 'reviews',
    source: batchSource,
    totalRows: reviews.length,
    created,
    updated,
    skipped,
    issueCount: issues.length,
  });

  return NextResponse.json({
    accountKey,
    totalRows: reviews.length,
    created,
    updated,
    skipped,
    issues,
  });
}
