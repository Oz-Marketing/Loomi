import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordIngestRun } from '@/lib/contacts/ingest-runs';

// POST /api/ingest/mailer-campaigns
//
// Direct-mail matchback RESULTS, pushed by Oz Reports' `/loomi/pushmailer`.
// Same Bearer secret (OZ_INGEST_SECRET) as the other ingest routes.
//
// ── WHY RESULTS AND NOT ROWS ────────────────────────────────────────────────
// Every other ingest takes raw rows and lets Loomi compute. This one takes a
// computed matchback, because the join it depends on cannot happen here: mailed
// recipients are matched to repair orders on `custno`, the DMS customer number,
// and Loomi has no custno. Shipping raw recipients would move the name and
// address of everyone mailed AND still not work on arrival.
//
// So the batch is small — one row per campaign per rooftop — and each row is an
// aggregate, never a person.
//
// Body: { accountKey, campaigns: [ { idempotencyKey, campaignName, mailerType,
//         mailedFrom, mailedTo, marketed, engaged, offerRequests,
//         matchedCustomers, matchedRos, directMatches, indirectMatches,
//         customerPay, warrantyPay } ] }

const MAX_CAMPAIGNS_PER_REQUEST = 500;

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

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
};
const int = (v: unknown): number => {
  const n = Math.round(Number(v ?? 0));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const money = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

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

  const accountKey = str(body.accountKey);
  if (!accountKey) return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });

  const campaigns = body.campaigns;
  if (!Array.isArray(campaigns)) {
    return NextResponse.json({ error: 'campaigns must be an array' }, { status: 400 });
  }
  if (campaigns.length > MAX_CAMPAIGNS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Batch exceeds ${MAX_CAMPAIGNS_PER_REQUEST} campaigns` },
      { status: 413 },
    );
  }

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true },
  });
  if (!account) {
    return NextResponse.json({ error: `Unknown accountKey: ${accountKey}` }, { status: 404 });
  }

  const batchSource = str(body.source);

  if (campaigns.length === 0) {
    await recordIngestRun({
      accountKey,
      kind: 'mailer',
      source: batchSource,
      totalRows: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      issueCount: 0,
    });
    return NextResponse.json({ totalRows: 0, created: 0, updated: 0, skipped: 0, issues: [] });
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const issues: { index: number; reason: string }[] = [];

  for (let i = 0; i < campaigns.length; i++) {
    const c = campaigns[i] ?? {};
    const key = str(c.idempotencyKey);
    const name = str(c.campaignName);
    const mailedFrom = c.mailedFrom ? new Date(String(c.mailedFrom)) : null;
    const mailedTo = c.mailedTo ? new Date(String(c.mailedTo)) : null;

    if (!key || !name || !mailedFrom || !mailedTo || Number.isNaN(mailedFrom.getTime()) || Number.isNaN(mailedTo.getTime())) {
      skipped += 1;
      if (issues.length < 20) {
        issues.push({ index: i, reason: 'Missing idempotencyKey, campaignName, or mail dates' });
      }
      continue;
    }

    const matchedCustomers = int(c.matchedCustomers);
    const marketed = int(c.marketed);

    // More responders than pieces mailed is arithmetically impossible and
    // means the matchback filtered the two sides differently — store it and
    // the report publishes a matchback rate above 100%.
    if (matchedCustomers > marketed) {
      skipped += 1;
      if (issues.length < 20) {
        issues.push({
          index: i,
          reason: `matchedCustomers (${matchedCustomers}) exceeds marketed (${marketed})`,
        });
      }
      continue;
    }

    const data = {
      accountKey,
      campaignName: name,
      mailerType: str(c.mailerType),
      mailedFrom,
      mailedTo,
      marketed,
      engaged: int(c.engaged),
      // Null and 0 mean different things: an FLF campaign has no offers at
      // all, an LS campaign can have none requested.
      offerRequests: c.offerRequests === null || c.offerRequests === undefined ? null : int(c.offerRequests),
      matchedCustomers,
      matchedRos: int(c.matchedRos),
      directMatches: int(c.directMatches),
      indirectMatches: int(c.indirectMatches),
      customerPay: money(c.customerPay),
      warrantyPay: money(c.warrantyPay),
    };

    try {
      const existing = await prisma.mailerCampaign.findUnique({
        where: { idempotencyKey: key },
        select: { id: true },
      });
      if (existing) {
        // Re-push matters: the 45-day service window stays open after the
        // mail drops, so a campaign's matched ROs keep growing for weeks.
        await prisma.mailerCampaign.update({ where: { idempotencyKey: key }, data });
        updated += 1;
      } else {
        await prisma.mailerCampaign.create({ data: { idempotencyKey: key, ...data } });
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
    `[ingest:mailer] account=${accountKey} received=${campaigns.length} ` +
      `created=${created} updated=${updated} skipped=${skipped}`,
  );

  await recordIngestRun({
    accountKey,
    kind: 'mailer',
    source: batchSource,
    totalRows: campaigns.length,
    created,
    updated,
    skipped,
    issueCount: issues.length,
  });

  return NextResponse.json({ totalRows: campaigns.length, created, updated, skipped, issues });
}
