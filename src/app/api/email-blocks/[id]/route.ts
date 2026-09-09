/**
 * A single reusable email block — /api/email-blocks/[id]
 *
 * PATCH  → rename (managers).
 * DELETE → soft-delete (managers). The email twin of
 * `/api/ad-generator/blocks/[id]`, and deliberately the same shape: a designer
 * who has removed an ad lockup should not have to learn a second set of rules
 * for an email one.
 *
 * SOFT, not hard. A block is COPIED into a template on insert, so removing it
 * cannot break anything already built — but it can be the only record of how a
 * card was put together, and "delete" in a palette means "stop offering this",
 * not "erase it". Flipping `isActive` also keeps the row available if someone
 * asks for it back the same afternoon, which a DELETE cannot.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The accounts a block is scoped to. Empty = global. */
function blockKeys(accountKeys: string | null): string[] {
  if (!accountKeys) return [];
  try {
    const arr = JSON.parse(accountKeys);
    return Array.isArray(arr) ? arr.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The scope check both verbs share: a scoped admin may only touch a block if
 * they can reach ALL its accounts. Same rule as the ad-block route, including
 * that a global block (no keys) passes — `studio.templates.edit` is already the
 * bar for authoring the shared library, so a second, stricter one here would
 * only be inconsistent with its sibling.
 *
 * Returns a response to send instead, or null when the write may proceed.
 */
async function denyWrite(id: string): Promise<NextResponse | null> {
  const block = await prisma.emailBlock.findUnique({
    where: { id },
    select: { accountKeys: true },
  });
  if (!block) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const session = await getAuthSession();
  const keys = blockKeys(block.accountKeys);
  const scope = getAccountScope(session!);
  if (scope !== null && keys.length > 0 && keys.some((k) => !scope.includes(k))) {
    return NextResponse.json({ error: 'Access denied for that block' }, { status: 403 });
  }
  return null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requirePermission('studio.templates.edit');
  if (error) return error;
  const { id } = await params;

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Rename only. Re-scoping and overwriting the doc are real operations but
  // they are not this one, and silently accepting fields nobody sends is how a
  // route grows behaviour no caller asked for.
  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  try {
    const denied = await denyWrite(id);
    if (denied) return denied;
    await prisma.emailBlock.update({ where: { id }, data: { name } });
    return NextResponse.json({ ok: true, name });
  } catch (err) {
    console.error('[api/email-blocks/[id]] rename failed:', err);
    return NextResponse.json({ error: 'Could not rename this block' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Same bar as creating one, and the same bar as authoring a template.
  const { error } = await requirePermission('studio.templates.edit');
  if (error) return error;
  const { id } = await params;

  try {
    const denied = await denyWrite(id);
    if (denied) return denied;
    await prisma.emailBlock.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/email-blocks/[id]] delete failed:', err);
    return NextResponse.json({ error: 'Could not delete this block' }, { status: 500 });
  }
}
