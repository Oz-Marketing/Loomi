import { NextRequest, NextResponse } from 'next/server';
import { requireInternalJobAuth } from '@/lib/internal-jobs';
import { prisma } from '@/lib/prisma';
import { parseChangelogFromPrBody } from '@/lib/changelog-pr';

/**
 * POST /api/internal/changelog/import
 *
 * Called by .github/workflows/changelog.yml when a PR merges into main. Parses
 * the `## Changelog` block out of the PR description and files each entry as a
 * DRAFT — nothing is visible, and nobody is emailed, until a human presses
 * Publish in Loomi.
 *
 * Idempotent on `sourceKey` ("pr:<number>#<index>"). The importer only ever
 * CREATES: an entry that already exists for that key is left exactly as it is,
 * so re-running the workflow — or re-merging after a revert — can neither
 * duplicate an entry nor overwrite wording that was edited in Loomi afterwards.
 *
 * Body: { prNumber: number, prBody: string, author?: string }
 *
 *   curl -X POST -H "x-internal-job-secret: $INTERNAL_JOB_SECRET" \
 *     -H 'Content-Type: application/json' \
 *     -d '{"prNumber":412,"prBody":"## Changelog\ntitle: …"}' \
 *     https://studio.loomilm.com/api/internal/changelog/import
 */
export async function POST(req: NextRequest) {
  const authError = requireInternalJobAuth(req);
  if (authError) return authError;

  let body: { prNumber?: unknown; prBody?: unknown; author?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const prNumber = Number(body.prNumber);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return NextResponse.json({ error: 'prNumber must be a positive integer' }, { status: 400 });
  }

  const prBody = typeof body.prBody === 'string' ? body.prBody : '';
  const author = typeof body.author === 'string' && body.author.trim() ? body.author.trim() : null;

  const parsed = parseChangelogFromPrBody(prBody);
  if (parsed.length === 0) {
    // Not an error. Most PRs are plumbing and shouldn't produce a release note.
    return NextResponse.json({ created: 0, skipped: 0, reason: 'no changelog block' });
  }

  let created = 0;
  let skipped = 0;

  for (const [index, entry] of parsed.entries()) {
    // Index-suffixed so a PR declaring several entries gets a stable key per
    // entry, and re-running matches them up one-to-one.
    const sourceKey = `pr:${prNumber}#${index}`;

    const existing = await prisma.changelogEntry.findUnique({
      where: { sourceKey },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.changelogEntry.create({
      data: {
        title: entry.title,
        content: entry.content,
        type: entry.type,
        audience: entry.audience,
        status: 'draft',
        sourceKey,
        createdBy: author,
      },
    });
    created += 1;
  }

  return NextResponse.json({ created, skipped, prNumber });
}
