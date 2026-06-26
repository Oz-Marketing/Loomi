import { listTeamsWithMembers, listInternalUsers } from '@/lib/services/teams';
import { TeamsManager, type TeamDTO, type UserDTO } from './_components/teams-manager';

/**
 * Teams settings — manage the delivery teams that Projects tickets route to,
 * and who belongs to each. Internal-staff only (gated by the App layout).
 * Server-loads initial data; the client manager owns edits.
 */
export default async function TeamsSettingsPage() {
  const [teamsRaw, usersRaw] = await Promise.all([
    listTeamsWithMembers(),
    listInternalUsers(),
  ]);

  const teams: TeamDTO[] = teamsRaw.map((t) => ({
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
  }));

  const users: UserDTO[] = usersRaw.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    department: u.department,
    role: u.role,
  }));

  return <TeamsManager initialTeams={teams} users={users} />;
}
