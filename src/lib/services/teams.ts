import { prisma } from '@/lib/prisma';
import { MANAGEMENT_ROLES } from '@/lib/roles';

/**
 * Teams service — the managed delivery-team list that Projects tickets route
 * to (Development, Digital Ads, …). Distinct from User.department: a Team is
 * the work-routing unit and a user can belong to several. Seeded once with the
 * agency's six teams; managed in the App surface's Teams settings.
 */

export const DEFAULT_TEAMS = [
  { key: 'development', name: 'Development', color: '#6366f1' },
  { key: 'digital-ads', name: 'Digital Ads', color: '#0ea5e9' },
  { key: 'organic-social', name: 'Organic Social', color: '#10b981' },
  { key: 'pr-mass-media', name: 'PR & Mass Media', color: '#f59e0b' },
  { key: 'video-production', name: 'Video Production', color: '#ef4444' },
  { key: 'graphic-design', name: 'Graphic Design', color: '#ec4899' },
] as const;

const MEMBER_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  department: true,
  role: true,
} as const;

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'team'
  );
}

/** Seed the six default teams the first time the table is empty (idempotent). */
export async function ensureDefaultTeams(): Promise<void> {
  const count = await prisma.team.count();
  if (count > 0) return;
  await prisma.team.createMany({
    data: DEFAULT_TEAMS.map((t, i) => ({
      key: t.key,
      name: t.name,
      color: t.color,
      sortOrder: i,
    })),
    skipDuplicates: true,
  });
}

export async function listTeams() {
  await ensureDefaultTeams();
  return prisma.team.findMany({
    where: { archivedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function listTeamsWithMembers() {
  await ensureDefaultTeams();
  return prisma.team.findMany({
    where: { archivedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      memberships: {
        include: { user: { select: MEMBER_USER_SELECT } },
        orderBy: { createdAt: 'asc' },
      },
      _count: { select: { tasks: true } },
    },
  });
}

type TeamRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string | null;
  memberships: Array<{
    userId: string;
    role: string;
    user: { name: string; email: string; avatarUrl: string | null; department: string | null };
  }>;
  _count: { tasks: number };
};

/** Flatten a team + memberships row into the plain shape the UI consumes. */
export function serializeTeam(t: TeamRow) {
  return {
    id: t.id,
    key: t.key,
    name: t.name,
    description: t.description,
    color: t.color,
    taskCount: t._count.tasks,
    members: t.memberships.map((m) => ({
      userId: m.userId,
      role: m.role,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      department: m.user.department,
    })),
  };
}

export async function getTeamWithMembers(id: string) {
  const t = await prisma.team.findUnique({
    where: { id },
    include: {
      memberships: {
        include: { user: { select: MEMBER_USER_SELECT } },
        orderBy: { createdAt: 'asc' },
      },
      _count: { select: { tasks: true } },
    },
  });
  return t ? serializeTeam(t) : null;
}

async function uniqueKey(name: string): Promise<string> {
  const base = slugify(name);
  let key = base;
  let n = 1;
  // Collisions are rare; cap the probe so a pathological input can't loop.
  while (n < 50 && (await prisma.team.findUnique({ where: { key } }))) {
    n += 1;
    key = `${base}-${n}`;
  }
  return key;
}

export async function createTeam(input: {
  name: string;
  description?: string | null;
  color?: string | null;
}) {
  const name = input.name.trim();
  const key = await uniqueKey(name);
  const max = await prisma.team.aggregate({ _max: { sortOrder: true } });
  return prisma.team.create({
    data: {
      key,
      name,
      description: input.description?.trim() || null,
      color: input.color || null,
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
  });
}

export async function updateTeam(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    color?: string | null;
    sortOrder?: number;
  },
) {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  if (patch.color !== undefined) data.color = patch.color || null;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  return prisma.team.update({ where: { id }, data });
}

/** Soft-archive (hide) a team — tasks keep their teamKey but the team drops
 * out of pickers and boards. */
export async function archiveTeam(id: string) {
  return prisma.team.update({ where: { id }, data: { archivedAt: new Date() } });
}

/** Replace a team's full membership set, marking `leadIds` as leads. */
export async function setTeamMembers(teamId: string, userIds: string[], leadIds: string[] = []) {
  const unique = [...new Set(userIds)];
  const leadSet = new Set(leadIds);
  await prisma.$transaction([
    prisma.teamMembership.deleteMany({
      where: { teamId, ...(unique.length ? { userId: { notIn: unique } } : {}) },
    }),
    ...unique.map((userId) =>
      prisma.teamMembership.upsert({
        where: { teamId_userId: { teamId, userId } },
        update: { role: leadSet.has(userId) ? 'lead' : 'member' },
        create: { teamId, userId, role: leadSet.has(userId) ? 'lead' : 'member' },
      }),
    ),
  ]);
}

/** User ids on a team (used to notify a team when a ticket is filed). */
export async function getTeamMemberUserIds(teamKey: string): Promise<string[]> {
  const team = await prisma.team.findUnique({
    where: { key: teamKey },
    select: { memberships: { select: { userId: true } } },
  });
  return team?.memberships.map((m) => m.userId) ?? [];
}

/**
 * Who to notify when a ticket lands for a team: the leads if any are set,
 * otherwise the whole team. Returns null for an unknown team key.
 */
export async function getTeamNotifyTargets(
  teamKey: string,
): Promise<{ name: string; userIds: string[] } | null> {
  const team = await prisma.team.findUnique({
    where: { key: teamKey },
    select: { name: true, memberships: { select: { userId: true, role: true } } },
  });
  if (!team) return null;
  const leads = team.memberships.filter((m) => m.role === 'lead').map((m) => m.userId);
  const userIds = leads.length ? leads : team.memberships.map((m) => m.userId);
  return { name: team.name, userIds };
}

/** Internal staff eligible for team membership + task assignment. */
export async function listInternalUsers() {
  return prisma.user.findMany({
    where: { role: { in: [...MANAGEMENT_ROLES] } },
    select: MEMBER_USER_SELECT,
    orderBy: { name: 'asc' },
  });
}
