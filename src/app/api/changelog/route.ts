import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { coerceAudience, publishChangelogEntries } from '@/lib/changelog-publish';

/** Management roles see drafts and staff-only entries; everyone else doesn't. */
function isStaff(role: string | undefined): boolean {
  return (MANAGEMENT_ROLES as string[]).includes(role ?? '');
}

/**
 * GET /api/changelog
 *
 * List changelog entries (newest first). All authenticated users can read, but
 * what they see depends on their role: clients get published `everyone` entries
 * only, so neither an unfinished draft nor an internal-plumbing note leaks out.
 */
export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    const staff = isStaff(session!.user.role);
    const entries = await prisma.changelogEntry.findMany({
      where: staff ? {} : { status: 'published', audience: 'everyone' },
      orderBy: { publishedAt: 'desc' },
    });
    return NextResponse.json({ entries });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch changelog';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/changelog
 *
 * Create a new changelog entry.
 * Developer and admin only.
 * Body: { title, content, type?, audience?, status?, createdBy? }
 *
 * Defaults to `published` — the hand-written form is a deliberate act, so
 * making the author press Publish a second time would be busywork. Pass
 * `status: 'draft'` to park one instead.
 *
 * The row is always born a draft and then run through the shared publish path,
 * so notifying users has exactly one implementation no matter whether the entry
 * came from this form or from a merged PR.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const body = await req.json();
    const { title, content, type, audience, status, createdBy } = body;

    if (!title?.trim() || !content?.trim()) {
      return NextResponse.json({ error: 'Title and content are required' }, { status: 400 });
    }

    const author = createdBy || session!.user.name || 'Unknown';
    const created = await prisma.changelogEntry.create({
      data: {
        title: title.trim(),
        content: content.trim(),
        type: type || 'improvement',
        audience: coerceAudience(audience),
        status: 'draft',
        createdBy: author,
      },
    });

    if (status === 'draft') {
      return NextResponse.json({ entry: created });
    }

    await publishChangelogEntries([created.id], author);
    const entry = await prisma.changelogEntry.findUnique({ where: { id: created.id } });
    return NextResponse.json({ entry });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create changelog entry';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
