import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { LIFECYCLE_PRESETS } from '@/lib/smart-list-presets';

const AUTOMOTIVE_CATEGORY = 'automotive';

/**
 * POST /api/audiences/seed-lifecycle
 *
 * One-time bootstrap that seeds Loomi's six lifecycle audiences into an
 * automotive account. Called by the segments page on mount. Powersports
 * and other categories are skipped. Idempotent via the
 * `lifecyclePresetsSeededAt` marker on Account.
 */
export async function POST(req: Request) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const accountKey =
    body?.accountKey && typeof body.accountKey === 'string' ? body.accountKey.trim() : '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey required' }, { status: 400 });
  }

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  const isPrivileged = userRole === 'developer' || userRole === 'super_admin';
  if (!isPrivileged && !userAccountKeys.includes(accountKey)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true, category: true, lifecyclePresetsSeededAt: true },
  });

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const isAutomotive =
    (account.category ?? '').trim().toLowerCase() === AUTOMOTIVE_CATEGORY;
  if (!isAutomotive) {
    return NextResponse.json({ seeded: 0, reason: 'non-automotive' });
  }
  if (account.lifecyclePresetsSeededAt) {
    return NextResponse.json({ seeded: 0, reason: 'already-seeded' });
  }

  let seeded = 0;
  for (let i = 0; i < LIFECYCLE_PRESETS.length; i++) {
    const preset = LIFECYCLE_PRESETS[i];
    try {
      await prisma.audience.create({
        data: {
          name: preset.name,
          description: preset.description,
          accountKey,
          createdByUserId: session!.user.id,
          filters: JSON.stringify(preset.definition),
          color: preset.color,
          icon: preset.icon,
          sortOrder: i,
          providerMetadata: JSON.stringify({
            source: 'lifecycle-preset',
            presetId: preset.id,
          }),
        },
      });
      seeded++;
    } catch (err) {
      // Account already has a segment with this name — leave their version alone.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        continue;
      }
      throw err;
    }
  }

  await prisma.account.update({
    where: { key: accountKey },
    data: { lifecyclePresetsSeededAt: new Date() },
  });

  return NextResponse.json({ seeded });
}
