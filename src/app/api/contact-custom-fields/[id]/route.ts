// Contact custom field — per-row routes (PATCH + DELETE).
//
// PATCH /api/contact-custom-fields/:id   → update label/type/options/etc.
// DELETE /api/contact-custom-fields/:id  → remove the row. Existing
//   values under this key in Contact.customFields are left untouched
//   (filter engine just stops surfacing them; re-creating the row
//   with the same key restores access).
//
// Role: admin+ for any write. Sub-account-owned writes require scope.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, canAccessAccount, getAccountScope } from '@/lib/api-auth';
import {
  CustomFieldValidationError,
  deleteField,
  updateField,
} from '@/lib/services/contact-custom-fields';

async function loadAndAuthorize(
  id: string,
  session: { user: { role: 'developer' | 'super_admin' | 'admin' | 'client'; accountKeys?: string[] } },
) {
  const row = await prisma.contactCustomField.findUnique({
    where: { id },
    select: { id: true, accountKey: true },
  });
  if (!row) {
    return { ok: false as const, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  // Blueprint writes require admin+ but are unscoped; sub-account
  // writes require scope on the owning account.
  if (row.accountKey) {
    const scope = getAccountScope(session);
    if (!canAccessAccount(scope, row.accountKey)) {
      return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
  }
  return { ok: true as const, row };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const { id } = await params;

  const auth = await loadAndAuthorize(id, session!);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const dto = await updateField(id, {
      label: typeof body.label === 'string' ? body.label : undefined,
      description: 'description' in body ? (body.description as string | null) : undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: typeof body.type === 'string' ? (body.type as any) : undefined,
      options:
        'options' in body
          ? Array.isArray(body.options)
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (body.options as any)
            : null
          : undefined,
      category: 'category' in body ? (body.category as string | null) : undefined,
      isPii: typeof body.isPii === 'boolean' ? body.isPii : undefined,
      sortOrder:
        typeof body.sortOrder === 'number' && Number.isFinite(body.sortOrder)
          ? body.sortOrder
          : undefined,
      industryTag:
        'industryTag' in body ? (body.industryTag as string | null) : undefined,
      csvAliases: Array.isArray(body.csvAliases)
        ? (body.csvAliases as string[])
        : undefined,
    });
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const { id } = await params;

  const auth = await loadAndAuthorize(id, session!);
  if (!auth.ok) return auth.response;

  await deleteField(id);
  return NextResponse.json({ ok: true });
}
