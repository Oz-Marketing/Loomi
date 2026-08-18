// Sync a sub-account custom field from its parent blueprint.
//
// POST /api/contact-custom-fields/:id/sync → refresh label/type/etc
// from the blueprint and stamp lastSyncedAt. Sub-account-scoped.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canAccessAccount, getAccountScope } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import {
  CustomFieldValidationError,
  syncFieldFromBlueprint,
} from '@/lib/services/contact-custom-fields';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission('studio.contact_fields.manage');
  if (error) return error;
  const { id } = await params;

  const row = await prisma.contactCustomField.findUnique({
    where: { id },
    select: { accountKey: true },
  });
  if (!row || !row.accountKey) {
    return NextResponse.json(
      { error: 'Not an account-owned field' },
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
