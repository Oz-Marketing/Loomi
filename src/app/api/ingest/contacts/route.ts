import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ingestContacts, type IngestContactInput } from '@/lib/contacts/ingest';

// POST /api/ingest/contacts
//
// Machine-to-machine contact ingestion. The permanent inbound path for
// CRM contacts — today fed by the Oz Reports bridge, later by native
// source adapters (both call this same endpoint).
//
// Auth: a shared Bearer secret (OZ_INGEST_SECRET), timing-safe compared,
// following the same convention as requireInternalJobAuth. No next-auth
// session — the caller is a server, not a browser.
//
// Body:
//   {
//     "accountKey": "youngHonda",
//     "source": "oz-reports",          // optional batch-level default
//     "contacts": [
//       {
//         "email": "…", "phone": "…",  // at least one required per row
//         "firstName": "…", "lastName": "…",
//         "tags": ["sales"],
//         "vehicleMake": "…", "purchaseDate": "2026-05-01",
//         "customFields": { "salesperson": "…" }
//       }
//     ]
//   }
//
// Idempotent: re-sending a batch merges (tags unioned, customFields
// merged) rather than duplicating. Safe to re-run the full backfill.

// Cap per request so a runaway batch can't exhaust memory / hold a
// connection open indefinitely. Oz Reports batches in the low hundreds.
const MAX_CONTACTS_PER_REQUEST = 1000;

function timingSafeCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
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

  const contacts = body.contacts;
  if (!Array.isArray(contacts)) {
    return NextResponse.json({ error: 'contacts must be an array' }, { status: 400 });
  }
  if (contacts.length === 0) {
    return NextResponse.json(
      { totalRows: 0, created: 0, updated: 0, skipped: 0, issues: [] },
      { status: 200 },
    );
  }
  if (contacts.length > MAX_CONTACTS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Batch exceeds ${MAX_CONTACTS_PER_REQUEST} contacts; split into smaller requests` },
      { status: 413 },
    );
  }

  // Reject unknown accounts up front with a clear error instead of
  // letting every row fail on the Contact.accountKey foreign key.
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true },
  });
  if (!account) {
    return NextResponse.json({ error: `Unknown accountKey: ${accountKey}` }, { status: 404 });
  }

  const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : undefined;

  const summary = await ingestContacts({
    accountKey,
    source,
    contacts: contacts as IngestContactInput[],
  });

  console.log(
    `[ingest:contacts] account=${accountKey} source=${source ?? '-'} ` +
      `received=${summary.totalRows} created=${summary.created} ` +
      `updated=${summary.updated} skipped=${summary.skipped}`,
  );

  return NextResponse.json(summary, { status: 200 });
}
