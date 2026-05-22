import { NextResponse } from 'next/server';
import { requireAuth, requireRole, forbidden } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { CONTACT_SELECT, serializeContact } from '@/lib/contacts/queries';
import * as listService from '@/lib/services/contact-lists';

// Member fetch is capped — same ceiling the broader contacts API uses
// for `?all=true`. v1 doesn't paginate members; if a single list grows
// past this we'll add cursor-based paging.
const MAX_MEMBERS_RETURNED = 5000;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteContext) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await ctx.params;
  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  const accountFilter =
    userRole === 'developer' || userRole === 'super_admin' ? undefined : userAccountKeys;

  const list = await listService.getListById(id, accountFilter);
  if (!list) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 });
  }

  const memberships = await prisma.contactListMembership.findMany({
    where: { listId: id },
    orderBy: { addedAt: 'desc' },
    take: MAX_MEMBERS_RETURNED,
    include: { contact: { select: CONTACT_SELECT } },
  });
  const members = memberships.map((row) => serializeContact(row.contact));

  return NextResponse.json({ list, members });
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await ctx.params;

  const existing = await prisma.contactList.findUnique({
    where: { id },
    select: { accountKey: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 });
  }

  if (session!.user.role === 'admin') {
    const assigned = session!.user.accountKeys ?? [];
    if (assigned.length > 0 && !assigned.includes(existing.accountKey)) {
      return forbidden();
    }
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const updates: { name?: string; description?: string | null } = {};
  if (typeof body.name === 'string') {
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    }
    updates.name = trimmed;
  }
  if (body.description !== undefined) {
    if (body.description === null) {
      updates.description = null;
    } else if (typeof body.description === 'string') {
      const trimmed = body.description.trim();
      updates.description = trimmed.length > 0 ? trimmed : null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  try {
    await listService.updateList(id, updates);
  } catch (err) {
    // Prisma P2002 — unique constraint on (accountKey, name) — surfaces here on rename collisions.
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      return NextResponse.json(
        { error: 'A list with that name already exists for this account' },
        { status: 409 },
      );
    }
    throw err;
  }

  const list = await listService.getListById(id);
  return NextResponse.json({ list });
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await ctx.params;

  // Look the list up first so we can authz against its accountKey before deleting.
  const existing = await prisma.contactList.findUnique({
    where: { id },
    select: { accountKey: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 });
  }

  if (session!.user.role === 'admin') {
    const assigned = session!.user.accountKeys ?? [];
    if (assigned.length > 0 && !assigned.includes(existing.accountKey)) {
      return forbidden();
    }
  }

  await listService.deleteList(id);
  return NextResponse.json({ ok: true });
}
