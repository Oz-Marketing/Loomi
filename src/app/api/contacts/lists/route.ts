import { NextResponse } from 'next/server';
import { requireAuth, requireRole, forbidden } from '@/lib/api-auth';
import * as listService from '@/lib/services/contact-lists';

/**
 * GET /api/contacts/lists
 * List contact lists accessible to the current user.
 */
export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];

  const lists =
    userRole === 'developer' || userRole === 'super_admin'
      ? await listService.getLists()
      : await listService.getLists(userAccountKeys);

  return NextResponse.json({ lists });
}

/**
 * POST /api/contacts/lists
 * Create a new contact list. Admins can only create lists for their
 * assigned accounts; developers / super_admins are unrestricted.
 */
export async function POST(req: Request) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : null;
  const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim() : '';

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  if (session!.user.role === 'admin') {
    const assigned = session!.user.accountKeys ?? [];
    if (assigned.length > 0 && !assigned.includes(accountKey)) {
      return forbidden();
    }
  }

  try {
    const list = await listService.createList({
      name,
      description: description || null,
      accountKey,
      createdByUserId: session!.user.id,
    });
    return NextResponse.json({ list }, { status: 201 });
  } catch (err) {
    // Prisma P2002 — unique constraint on (accountKey, name).
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      return NextResponse.json(
        { error: 'A list with that name already exists for this account' },
        { status: 409 },
      );
    }
    throw err;
  }
}
