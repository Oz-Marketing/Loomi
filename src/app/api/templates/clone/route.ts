import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import { hasUnrestrictedAccountAccess } from '@/lib/roles';
import * as templateService from '@/lib/services/templates';

export async function POST(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const { sourceDesign, newDesign, accountKey } = await req.json();

    if (!sourceDesign) {
      return NextResponse.json({ error: 'Source design is required' }, { status: 400 });
    }

    const role = session!.user.role;
    const userAccountKeys = session!.user.accountKeys ?? [];
    const unrestricted = hasUnrestrictedAccountAccess(role, userAccountKeys);

    // null = clone into library (inherits source's accountKey), '' / non-string = same
    // string = clone into that specific subaccount (must have access).
    let targetAccountKey: string | null | undefined = undefined;
    if (typeof accountKey === 'string') {
      const trimmed = accountKey.trim();
      if (trimmed) {
        if (!unrestricted && !userAccountKeys.includes(trimmed)) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        targetAccountKey = trimmed;
      } else {
        // Empty string explicitly means "clone into library". Management-only.
        targetAccountKey = null;
      }
    }

    const cloned = await templateService.cloneTemplate(
      sourceDesign,
      newDesign || undefined,
      session!.user.id,
      targetAccountKey,
    );

    return NextResponse.json({
      success: true,
      design: cloned.slug,
      name: cloned.title,
      accountKey: cloned.accountKey,
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'Template already exists' }, { status: 409 });
    }
    const message = err?.message || 'Failed to clone template';
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
