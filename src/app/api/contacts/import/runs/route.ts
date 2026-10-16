import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import { canImportForAccount, serializeImportRun } from '@/lib/contacts/import-runs';

// GET /api/contacts/import/runs?accountKey=
//   The account's recent contact imports, newest first — what the Contacts
//   screen's import panel reads. Never includes the stored CSV.

const RECENT_RUNS = 20;

export async function GET(req: NextRequest) {
  const { session, error } = await requirePermission('studio.contacts.import');
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim() ?? '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }
  if (!canImportForAccount(session!.user, accountKey)) {
    return NextResponse.json({ error: 'Forbidden for this account' }, { status: 403 });
  }

  const runs = await prisma.contactImportRun.findMany({
    where: { accountKey },
    orderBy: { startedAt: 'desc' },
    take: RECENT_RUNS,
    omit: { csvText: true, mapping: true },
  });

  const now = Date.now();
  return NextResponse.json({
    runs: runs.map((run) => serializeImportRun({ ...run, csvText: '', mapping: '' }, now)),
  });
}
