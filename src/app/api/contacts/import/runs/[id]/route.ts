import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import { canImportForAccount, serializeImportRun } from '@/lib/contacts/import-runs';

// GET /api/contacts/import/runs/:id — one import's progress, polled by the
// import page while it runs.

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteContext) {
  const { session, error } = await requirePermission('studio.contacts.import');
  if (error) return error;

  const { id } = await ctx.params;
  const run = await prisma.contactImportRun.findUnique({
    where: { id },
    omit: { csvText: true, mapping: true },
  });
  // Same 404 for "not yours" as for "doesn't exist".
  if (!run || !canImportForAccount(session!.user, run.accountKey)) {
    return NextResponse.json({ error: 'Import not found' }, { status: 404 });
  }

  return NextResponse.json({ run: serializeImportRun({ ...run, csvText: '', mapping: '' }) });
}
