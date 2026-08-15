/**
 * Co-op pre-approval of a template — /api/ad-generator/templates-doc/[id]/coop-approval
 *
 * GET  → every approval on file plus the standing for one make.
 * POST → record an approval (`{ make, packVersion?, reference?, note? }`).
 * DELETE → withdraw the live approvals for a make (`?make=Chevrolet`).
 *
 * Admin-gated. This is the record that lets ads launch with no per-ad reviewer, so
 * writing it is a privileged act and every row carries who did it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import { resolveTemplateApproval } from '@/lib/ad-generator/coop-approval';
import { listApprovals, recordApproval, revokeApprovals } from '@/lib/ad-generator/coop-approval-store';
import { loadActiveCoopPack } from '@/lib/ad-generator/coop-pack-store';
import { designHash } from '@/lib/ad-generator/template-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The template's current design hash, or null when it can't be read. */
async function currentDocHash(id: string): Promise<string | null> {
  const row = await prisma.adTemplateDoc.findUnique({ where: { id }, select: { doc: true } }).catch(() => null);
  if (!row?.doc) return null;
  try {
    const doc = JSON.parse(row.doc) as TemplateDoc;
    return Array.isArray(doc?.sizes) ? designHash(doc) : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const make = (req.nextUrl.searchParams.get('make') || '').trim();
  const [approvals, docHash] = await Promise.all([listApprovals(id), currentDocHash(id)]);

  // The standing is only meaningful for a specific make, so it's computed when one
  // is named. Without a make the caller still gets the rows.
  let status = null;
  if (make && docHash) {
    const pack = await loadActiveCoopPack(make);
    status = resolveTemplateApproval(approvals, {
      docHash,
      make,
      activePackVersion: pack?.pack.version ?? null,
    });
  }

  return NextResponse.json({ approvals, docHash, status });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const session = await getAuthSession();
  const u = session?.user as { id?: string; name?: string | null } | undefined;

  const { id } = await params;
  let body: { make?: string; packVersion?: string; reference?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const make = (body.make ?? '').trim();
  if (!make) return NextResponse.json({ error: 'A make is required' }, { status: 400 });

  // Default the edition to whatever pack is currently in force, so the common case
  // needs no typing and the approval still records what it was granted against.
  const pack = await loadActiveCoopPack(make);
  const result = await recordApproval({
    templateId: id,
    make,
    packVersion: body.packVersion?.trim() || pack?.pack.version || null,
    reference: body.reference,
    note: body.note,
    approvedById: u?.id ?? null,
    approvedByName: u?.name ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const approvals = await listApprovals(id);
  return NextResponse.json({
    ok: true,
    docHash: result.docHash,
    status: resolveTemplateApproval(approvals, {
      docHash: result.docHash,
      make,
      activePackVersion: pack?.pack.version ?? null,
    }),
    approvals,
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const session = await getAuthSession();
  const u = session?.user as { name?: string | null } | undefined;

  const { id } = await params;
  const make = (req.nextUrl.searchParams.get('make') || '').trim();
  if (!make) return NextResponse.json({ error: 'A make is required' }, { status: 400 });

  const count = await revokeApprovals({ templateId: id, make, revokedByName: u?.name ?? null });
  return NextResponse.json({ ok: true, revoked: count, approvals: await listApprovals(id) });
}
