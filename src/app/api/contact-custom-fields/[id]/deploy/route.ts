// Deploy a blueprint to one or more sub-accounts.
//
// POST /api/contact-custom-fields/:id/deploy
//   Body: { accountKeys: string[] }
//
// `:id` must be a blueprint (accountKey=null). For each target
// sub-account: if an instance with this parentBlueprintId already
// exists it's skipped (idempotent); otherwise we copy the blueprint
// row across with parentBlueprintId set and lastSyncedAt stamped.
//
// Admin+ only.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, getAccountScope } from '@/lib/api-auth';
import { deployBlueprintToAccounts } from '@/lib/services/contact-custom-fields';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const { id } = await params;

  const blueprint = await prisma.contactCustomField.findUnique({
    where: { id },
    select: { accountKey: true },
  });
  if (!blueprint || blueprint.accountKey !== null) {
    return NextResponse.json(
      { error: 'Not a blueprint' },
      { status: 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rawKeys = body.accountKeys;
  if (!Array.isArray(rawKeys) || rawKeys.length === 0) {
    return NextResponse.json(
      { error: 'accountKeys (non-empty string[]) is required' },
      { status: 400 },
    );
  }
  let accountKeys = rawKeys
    .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
    .map((k) => k.trim());

  // Admins are scoped to their assigned accountKeys; silently filter out
  // any deploy targets outside their scope. developer / super_admin have
  // null scope and pass through unchanged.
  const scope = getAccountScope(session!);
  if (scope) accountKeys = accountKeys.filter((k) => scope.includes(k));
  if (accountKeys.length === 0) {
    return NextResponse.json(
      { error: 'No accessible sub-accounts in the deploy list' },
      { status: 403 },
    );
  }

  const result = await deployBlueprintToAccounts(id, accountKeys);
  return NextResponse.json(result);
}
