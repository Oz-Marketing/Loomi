import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { forbidTemplateMutation } from '@/lib/flows/route-guards';
import { getFlow, restoreFlow } from '@/lib/services/loomi-flows';

// POST /api/flows/[id]/restore — admin-gated.
//
// Pulls an archived flow back to draft state and clears archivedAt
// so the 30-day purge sweep leaves it alone. No-op (returns 400)
// when the row isn't currently archived — restoring a live flow
// shouldn't silently flip it back to draft.
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  const scope =
    session!.user.role === 'admin'
      ? (session!.user.accountKeys ?? [])
      : null;
  const existing = await getFlow(id, scope);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const templateGuard = forbidTemplateMutation(existing.accountKey, scope);
  if (templateGuard) return templateGuard;

  if (existing.status !== 'archived') {
    return NextResponse.json(
      { error: 'Flow is not archived — nothing to restore.' },
      { status: 400 },
    );
  }

  const flow = await restoreFlow(id);
  return NextResponse.json({ flow });
}
