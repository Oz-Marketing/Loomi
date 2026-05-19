import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as templateService from '@/lib/services/templates';

/**
 * POST /api/templates/publish
 *
 * Set the published state for one or more library templates.
 * Body: { slugs: string[], published: boolean }
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const body = await req.json();
    const { slugs, published } = body as { slugs?: unknown; published?: unknown };

    if (!Array.isArray(slugs) || slugs.length === 0 || !slugs.every((s) => typeof s === 'string')) {
      return NextResponse.json(
        { error: 'slugs must be a non-empty array of strings' },
        { status: 400 },
      );
    }
    if (typeof published !== 'boolean') {
      return NextResponse.json(
        { error: 'published must be a boolean' },
        { status: 400 },
      );
    }

    const result = await templateService.setPublishedBulk(
      slugs as string[],
      published,
      session!.user.id,
    );

    return NextResponse.json({ success: true, updated: result.count, published });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update publish state';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
