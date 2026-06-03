import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { forbidTemplateMutation } from '@/lib/flows/route-guards';
import {
  FlowValidationError,
  getFlow,
  publishFlow,
} from '@/lib/services/loomi-flows';

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  const scope =
    session!.user.role === 'client' || session!.user.role === 'admin'
      ? (session!.user.accountKeys ?? [])
      : null;
  const existing = await getFlow(id, scope);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const templateGuard = forbidTemplateMutation(existing.accountKey, scope);
  if (templateGuard) return templateGuard;

  try {
    const flow = await publishFlow(id);
    return NextResponse.json({ flow });
  } catch (err) {
    if (err instanceof FlowValidationError) {
      // `issues` is the structured array: each entry has { nodeId,
      // message } so the builder can highlight specific steps in red
      // and surface messages in their inspectors.
      return NextResponse.json(
        { error: 'Flow validation failed', issues: err.issues },
        { status: 400 },
      );
    }
    throw err;
  }
}
