// Sync a sub-account custom field from its parent blueprint.
//
// POST /api/contact-custom-fields/:id/sync → refresh label/type/etc
// from the blueprint and stamp lastSyncedAt. Sub-account-scoped.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, canAccessAccount, getAccountScope } from '@/lib/api-auth';
import {
  CustomFieldValidationError,
  syncFieldFromBlueprint,
} from '@/lib/services/contact-custom-fields';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const { id } = await params;

  const row = await prisma.contactCustomField.findUnique({
    where: { id },
    select: { accountKey: true },
  });
  if (!row || !row.accountKey) {
    return NextResponse.json(
      { error: 'Not a sub-account-owned field' },
      { status: 400 },
    );
  }
  const scope = getAccountScope(session!);
  if (!canAccessAccount(scope, row.accountKey)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const dto = await syncFieldFromBlueprint(id);
    return NextResponse.json({ field: dto });
  } catch (err) {
    if (err instanceof CustomFieldValidationError) {
      return NextResponse.json(
        { error: err.message, field: err.field },
        { status: 400 },
      );
    }
    throw err;
  }
}
