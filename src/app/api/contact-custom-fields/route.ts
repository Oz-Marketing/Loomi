// Contact custom fields — collection routes.
//
// GET  /api/contact-custom-fields?accountKey=X     → sub-account fields
// GET  /api/contact-custom-fields?blueprints=true  → admin blueprints
//                                                    + per-blueprint adoption
// POST /api/contact-custom-fields                  → create
//   Body: { accountKey: string | null, key, label, type, ... }
//   accountKey=null requires admin+ role (blueprint).
//   accountKey set requires admin+ role on that account.
//
// Reads are open to clients on their assigned accounts; writes are
// gated to admin / super_admin / developer. Blueprints are admin+
// across the board.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole, canAccessAccount, getAccountScope } from '@/lib/api-auth';
import {
  CustomFieldValidationError,
  createField,
  getBlueprintAdoption,
  listBlueprints,
  listFieldsForAccount,
} from '@/lib/services/contact-custom-fields';

export async function GET(req: NextRequest) {
  const wantBlueprints = req.nextUrl.searchParams.get('blueprints') === 'true';

  if (wantBlueprints) {
    const { error } = await requireRole('developer', 'super_admin', 'admin');
    if (error) return error;

    const blueprints = await listBlueprints();
    const adoption = await getBlueprintAdoption(blueprints.map((b) => b.id));
    return NextResponse.json({
      blueprints: blueprints.map((b) => ({
        ...b,
        adoption: adoption.get(b.id) ?? { total: 0, stale: 0 },
      })),
    });
  }

  const { session, error } = await requireAuth();
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim() ?? '';
  if (!accountKey) {
    return NextResponse.json(
      { error: 'accountKey is required (or pass blueprints=true)' },
      { status: 400 },
    );
  }

  const scope = getAccountScope(session!);
  if (!canAccessAccount(scope, accountKey)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const fields = await listFieldsForAccount(accountKey);
  return NextResponse.json({ fields });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const accountKey =
    typeof body.accountKey === 'string' && body.accountKey.trim()
      ? body.accountKey.trim()
      : null;

  // Admin role can write to any sub-account, but verify scope for
  // safety (matches the rest of the API surface).
  if (accountKey) {
    const scope = getAccountScope(session!);
    if (!canAccessAccount(scope, accountKey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  try {
    const dto = await createField({
      accountKey,
      key: String(body.key ?? ''),
      label: String(body.label ?? ''),
      description:
        typeof body.description === 'string' ? body.description : null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: body.type as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options: Array.isArray(body.options) ? (body.options as any) : null,
      category: typeof body.category === 'string' ? body.category : null,
      isPii: Boolean(body.isPii),
      sortOrder: Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0,
      industryTag:
        typeof body.industryTag === 'string' ? body.industryTag : null,
      csvAliases: Array.isArray(body.csvAliases)
        ? (body.csvAliases as string[])
        : [],
    });
    return NextResponse.json({ field: dto }, { status: 201 });
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
