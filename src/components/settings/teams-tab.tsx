'use client';

import useSWR from 'swr';
import { TeamsManager, type TeamDTO, type UserDTO } from '@/components/settings/teams-manager';

/**
 * Teams settings tab — the delivery teams Projects tickets route to, and who
 * belongs to each. Client-loads from GET /api/teams (teams-with-members +
 * internal users) so it can live inside the shared (client) Settings page;
 * the manager owns all edits.
 */

type ApiTeam = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  _count: { tasks: number };
  memberships: {
    userId: string;
    role: string;
    user: { name: string; email: string; avatarUrl: string | null; department: string | null };
  }[];
};
type ApiUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  department: string | null;
  role: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function TeamsTab() {
  const { data, isLoading } = useSWR<{ teams: ApiTeam[]; users: ApiUser[] }>(
    '/api/teams',
    fetcher,
    { revalidateOnFocus: false },
  );

  if (isLoading || !data) {
    return <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">Loading teams…</p>;
  }

  const teams: TeamDTO[] = data.teams.map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    description: t.description,
    color: t.color,
    icon: t.icon,
    taskCount: t._count.tasks,
    members: t.memberships.map((m) => ({
      userId: m.userId,
      role: m.role,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      department: m.user.department,
    })),
  }));

  const users: UserDTO[] = data.users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    department: u.department,
    role: u.role,
  }));

  return <TeamsManager initialTeams={teams} users={users} />;
}
