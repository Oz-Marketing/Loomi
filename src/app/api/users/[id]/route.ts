import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import { getUserTeamIds } from '@/lib/services/teams';
import { listCapabilities, listSectorRoles } from '@/lib/permissions/assignments';
import { sectorRoleRef } from '@/lib/permissions/registry';

function parseAccountKeys(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requirePermission('agency.users.view');
  if (error) return error;

  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      title: true,
      email: true,
      avatarUrl: true,
      role: true,
      department: true,
      accountKeys: true,
      createdAt: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const accountKeys = parseAccountKeys(user.accountKeys);
  const teamIds = await getUserTeamIds(id);
  // Fully-qualified refs (`studio.designer`) rather than {sector, role} pairs —
  // the client edits them as opaque strings and hands the same shape back.
  const sectorRoles = (await listSectorRoles(id)).map((r) =>
    sectorRoleRef(r.sector, r.role),
  );
  const capabilities = await listCapabilities(id);
  return NextResponse.json({
    ...user,
    accountKeys,
    teamIds,
    capabilities,
    sectorRoles,
  });
}
