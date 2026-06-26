'use client';

import { useState } from 'react';
import {
  PlusIcon,
  TrashIcon,
  UsersIcon,
  CheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarSolid } from '@heroicons/react/24/solid';
import { StarIcon as StarOutline } from '@heroicons/react/24/outline';
import { UserAvatar } from '@/components/user-avatar';
import { toast } from '@/lib/toast';

export type UserDTO = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  department: string | null;
  role: string;
};

export type TeamMemberDTO = {
  userId: string;
  role: string; // member | lead
  name: string;
  email: string;
  avatarUrl: string | null;
  department: string | null;
};

export type TeamDTO = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string | null;
  taskCount: number;
  members: TeamMemberDTO[];
};

const SWATCHES = [
  '#6366f1',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
];

export function TeamsManager({
  initialTeams,
  users,
}: {
  initialTeams: TeamDTO[];
  users: UserDTO[];
}) {
  const [teams, setTeams] = useState<TeamDTO[]>(initialTeams);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>(SWATCHES[0]);
  const [busy, setBusy] = useState(false);

  async function createTeam() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, color: newColor }),
      });
      if (!res.ok) throw new Error();
      const { team } = (await res.json()) as { team: TeamDTO };
      setTeams((prev) => [...prev, team]);
      setNewName('');
      setNewColor(SWATCHES[0]);
      setCreating(false);
      toast.success(`Team "${team.name}" created`);
    } catch {
      toast.error('Could not create team');
    } finally {
      setBusy(false);
    }
  }

  function replaceTeam(team: TeamDTO) {
    setTeams((prev) => prev.map((t) => (t.id === team.id ? team : t)));
  }

  async function archiveTeam(team: TeamDTO) {
    if (!confirm(`Archive "${team.name}"? Existing tasks keep their team tag but it drops out of pickers.`))
      return;
    setTeams((prev) => prev.filter((t) => t.id !== team.id));
    try {
      const res = await fetch(`/api/teams/${team.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success(`Archived "${team.name}"`);
    } catch {
      setTeams((prev) => [...prev, team].sort((a, b) => a.name.localeCompare(b.name)));
      toast.error('Could not archive team');
    }
  }

  return (
    <div className="py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--foreground)]">Teams</h1>
          <p className="mt-1 max-w-xl text-sm text-[var(--muted-foreground)]">
            The delivery teams that tickets route to, and who belongs to each.
            Separate from a user&apos;s account department — a person can serve
            several teams.
          </p>
        </div>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl bg-[var(--primary)] px-3.5 py-2 text-sm font-medium text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)] transition hover:opacity-90"
          >
            <PlusIcon className="h-4 w-4" />
            New team
          </button>
        )}
      </div>

      {creating && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 p-3">
          <div className="flex items-center gap-1.5">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                aria-label={`Color ${c}`}
                className={`h-5 w-5 rounded-full transition ${newColor === c ? 'ring-2 ring-offset-2 ring-offset-[var(--card)]' : ''}`}
                style={{ backgroundColor: c, boxShadow: newColor === c ? `0 0 0 2px ${c}` : undefined }}
              />
            ))}
          </div>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createTeam();
              if (e.key === 'Escape') setCreating(false);
            }}
            placeholder="Team name"
            className="min-w-[12rem] flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
          <button
            type="button"
            disabled={busy || !newName.trim()}
            onClick={createTeam}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            <CheckIcon className="h-4 w-4" /> Add
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-[var(--muted-foreground)] transition hover:bg-[var(--muted)]"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            users={users}
            onChange={replaceTeam}
            onArchive={() => archiveTeam(team)}
          />
        ))}
      </div>
    </div>
  );
}

function TeamCard({
  team,
  users,
  onChange,
  onArchive,
}: {
  team: TeamDTO;
  users: UserDTO[];
  onChange: (t: TeamDTO) => void;
  onArchive: () => void;
}) {
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const memberIds = new Set(team.members.map((m) => m.userId));
  const leadIds = new Set(team.members.filter((m) => m.role === 'lead').map((m) => m.userId));

  async function persist(nextMemberIds: string[], nextLeadIds: string[]) {
    setBusy(true);
    try {
      const res = await fetch(`/api/teams/${team.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memberIds: nextMemberIds, leadIds: nextLeadIds }),
      });
      if (!res.ok) throw new Error();
      const { team: updated } = (await res.json()) as { team: TeamDTO };
      onChange(updated);
    } catch {
      toast.error('Could not update members');
    } finally {
      setBusy(false);
    }
  }

  function toggleMember(userId: string) {
    const next = new Set(memberIds);
    const nextLeads = new Set(leadIds);
    if (next.has(userId)) {
      next.delete(userId);
      nextLeads.delete(userId);
    } else {
      next.add(userId);
    }
    persist([...next], [...nextLeads]);
  }

  function toggleLead(userId: string) {
    if (!memberIds.has(userId)) return;
    const nextLeads = new Set(leadIds);
    if (nextLeads.has(userId)) nextLeads.delete(userId);
    else nextLeads.add(userId);
    persist([...memberIds], [...nextLeads]);
  }

  const color = team.color || 'var(--primary)';

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--foreground)]">{team.name}</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {team.members.length} {team.members.length === 1 ? 'member' : 'members'} ·{' '}
              {team.taskCount} {team.taskCount === 1 ? 'task' : 'tasks'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onArchive}
          title="Archive team"
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-red-500/10 hover:text-red-500"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex -space-x-2">
          {team.members.slice(0, 6).map((m) => (
            <UserAvatar
              key={m.userId}
              name={m.name}
              email={m.email}
              avatarUrl={m.avatarUrl}
              size={28}
              className="h-7 w-7 rounded-full border-2 border-[var(--card)] object-cover"
            />
          ))}
          {team.members.length === 0 && (
            <span className="text-xs text-[var(--muted-foreground)]">No members yet</span>
          )}
          {team.members.length > 6 && (
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--card)] bg-[var(--muted)] text-[10px] font-medium text-[var(--muted-foreground)]">
              +{team.members.length - 6}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setManaging((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
        >
          <UsersIcon className="h-3.5 w-3.5" />
          {managing ? 'Done' : 'Manage members'}
        </button>
      </div>

      {managing && (
        <div className="mt-3 max-h-64 space-y-0.5 overflow-y-auto rounded-xl border border-[var(--border)] p-1.5">
          {users.map((u) => {
            const isMember = memberIds.has(u.id);
            const isLead = leadIds.has(u.id);
            return (
              <div
                key={u.id}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${isMember ? 'bg-[var(--primary)]/5' : ''}`}
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => toggleMember(u.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-50"
                >
                  <span
                    className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                      isMember
                        ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                        : 'border-[var(--border)]'
                    }`}
                  >
                    {isMember && <CheckIcon className="h-3 w-3" />}
                  </span>
                  <UserAvatar
                    name={u.name}
                    email={u.email}
                    avatarUrl={u.avatarUrl}
                    size={22}
                    className="h-[22px] w-[22px] rounded-full object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-[var(--foreground)]">
                      {u.name}
                    </span>
                    {u.department && (
                      <span className="block truncate text-[10px] text-[var(--muted-foreground)]">
                        {u.department}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={busy || !isMember}
                  onClick={() => toggleLead(u.id)}
                  title={isLead ? 'Team lead' : 'Make team lead'}
                  className="flex-shrink-0 rounded p-1 text-[var(--muted-foreground)] transition hover:text-amber-500 disabled:opacity-30"
                >
                  {isLead ? (
                    <StarSolid className="h-4 w-4 text-amber-500" />
                  ) : (
                    <StarOutline className="h-4 w-4" />
                  )}
                </button>
              </div>
            );
          })}
          {users.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-[var(--muted-foreground)]">
              No internal users to add yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
