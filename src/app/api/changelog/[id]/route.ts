import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { coerceAudience, publishChangelogEntries } from '@/lib/changelog-publish';

/**
 * PUT /api/changelog/[id]
 *
 * Update a changelog entry, and optionally publish it.
 * Developer and admin only.
 * Body: { title?, content?, type?, audience?, publish?: true }
 *
 * `publish: true` runs the shared publish path — flipping the status, stamping
 * the publish date, and notifying users. It is applied AFTER the field edits in
 * the same request, so "fix the wording, then announce it" is one action rather
 * than a save followed by a second round-trip that could announce the old text.
 * Publishing an already-published entry is a no-op, so nobody gets told twice.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { id } = await params;

  try {
    const existing = await prisma.changelogEntry.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    const body = await req.json();
    const { title, content, type, audience, publish } = body;

    await prisma.changelogEntry.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(content !== undefined && { content: content.trim() }),
        ...(type !== undefined && { type }),
        ...(audience !== undefined && { audience: coerceAudience(audience) }),
      },
    });

    if (publish === true) {
      await publishChangelogEntries([id], session!.user.name ?? null);
    }

    const entry = await prisma.changelogEntry.findUnique({ where: { id } });
    return NextResponse.json({ entry });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update changelog entry';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/changelog/[id]
 *
 * Delete a changelog entry.
 * Developer and admin only.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { id } = await params;

  try {
    const existing = await prisma.changelogEntry.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    await prisma.changelogEntry.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete changelog entry';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
