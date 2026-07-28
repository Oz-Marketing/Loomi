import { NextRequest, NextResponse } from 'next/server';
import { requireRole, requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import type { UserRole } from '@/lib/auth';

function parseAccountKeys(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * POST /api/impersonate
 *
 * Developer-only. Returns the target user's session-compatible data
 * so the frontend can swap the JWT via session.update().
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireRole('developer');
  if (error) return error;

  const { userId } = await req.json();
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      title: true,
      email: true,
      avatarUrl: true,
      role: true,
      accountKeys: true,
    },
  });

  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const accountKeys = parseAccountKeys(target.accountKeys);
  return NextResponse.json({
    id: target.id,
    name: target.name,
    title: target.title ?? null,
    email: target.email,
    avatarUrl: target.avatarUrl,
    role: target.role as UserRole,
    accountKeys,
    originalUserId: session!.user.id,
  });
}

/**
 * DELETE /api/impersonate
 *
 * Reverts impersonation. Looks up the original user from the
 * `originalUserId` stored in the current JWT and returns their data.
 */
export async function DELETE() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const originalId = session!.user.originalUserId;
  if (!originalId) {
    return NextResponse.json({ error: 'Not currently impersonating' }, { status: 400 });
  }

  const original = await prisma.user.findUnique({
    where: { id: originalId },
    select: {
      id: true,
      name: true,
      title: true,
      email: true,
      avatarUrl: true,
      role: true,
      accountKeys: true,
    },
  });

  if (!original) {
    return NextResponse.json({ error: 'Original user not found' }, { status: 404 });
  }

  const accountKeys = parseAccountKeys(original.accountKeys);
  return NextResponse.json({
    id: original.id,
    name: original.name,
    title: original.title ?? null,
    email: original.email,
    avatarUrl: original.avatarUrl,
    role: original.role as UserRole,
    accountKeys,
  });
}
