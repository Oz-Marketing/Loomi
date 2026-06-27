'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { PlusIcon, CheckIcon, XMarkIcon, TrashIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { StarIcon as StarSolid } from '@heroicons/react/24/solid';
import { StarIcon as StarOutline } from '@heroicons/react/24/outline';
import { UserAvatar } from '@/components/user-avatar';
import PrimaryButton from '@/components/primary-button';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { toast } from '@/lib/toast';
import { SettingsTable, type SettingsColumn } from '@/components/settings/settings-table';
import { IconPicker } from '@/components/ui/icon-picker';
import { LucideIcon } from '@/components/lucide-icon';

/** The team's glyph: its chosen lucide icon, else the default group icon (matches the settings-nav Teams tab). */
function TeamGlyph({ icon, className }: { icon: string | null; className?: string }) {
  return icon ? <LucideIcon name={icon} className={className} /> : <UserGroupIcon className={className} />;
}

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
  icon: string | null;
  taskCount: number;
  members: TeamMemberDTO[];
};

const SWATCHES = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];

export function TeamsManager({
  initialTeams,
  users,
}: {
  initialTeams: TeamDTO[];
  users: UserDTO[];
}) {
  const [teams, setTeams] = useState<TeamDTO[]>(initialTeams);
  // null = closed; 'new' = create; TeamDTO = edit that team.
  const [editing, setEditing] = useState<TeamDTO | 'new' | null>(null);

  const titleActionsEl =
    typeof document !== 'undefined' ? document.getElementById('settings-title-actions') : null;

  const columns: SettingsColumn<TeamDTO>[] = [
    {
      key: 'team',
      header: 'Team',
      cell: (t) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg"
            style={{
              color: t.color || 'var(--primary)',
              backgroundColor: `color-mix(in srgb, ${t.color || 'var(--primary)'} 14%, transparent)`,
            }}
          >
            <TeamGlyph icon={t.icon} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--foreground)]">{t.name}</p>
            {t.description && (
              <p className="truncate text-xs text-[var(--muted-foreground)]">{t.description}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'members',
      header: 'Members',
      cell: (t) =>
        t.members.length === 0 ? (
          <span className="text-xs text-[var(--muted-foreground)]">No members</span>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {t.members.slice(0, 6).map((m) => (
                <UserAvatar
                  key={m.userId}
                  name={m.name}
                  email={m.email}
                  avatarUrl={m.avatarUrl}
                  size={26}
                  className="h-[26px] w-[26px] rounded-full border-2 border-[var(--card)] object-cover"
                />
              ))}
              {t.members.length > 6 && (
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-[var(--card)] bg-[var(--muted)] text-[10px] font-medium text-[var(--muted-foreground)]">
                  +{t.members.length - 6}
                </span>
              )}
            </div>
            <span className="text-xs text-[var(--muted-foreground)]">{t.members.length}</span>
          </div>
        ),
    },
    {
      key: 'tasks',
      header: 'Tasks',
      cell: (t) => <span className="text-sm text-[var(--muted-foreground)]">{t.taskCount}</span>,
      thClassName: 'text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider w-24',
    },
  ];

  return (
    <div>
      {titleActionsEl &&
        createPortal(
          <PrimaryButton onClick={() => setEditing('new')}>
            <PlusIcon className="h-4 w-4" />
            New team
          </PrimaryButton>,
          titleActionsEl,
        )}

      <SettingsTable
        items={teams}
        columns={columns}
        getRowKey={(t) => t.id}
        onRowClick={(t) => setEditing(t)}
        minWidth={640}
        emptyMessage="No teams yet — create one to route tickets."
      />

      {editing && (
        <TeamEditModal
          team={editing === 'new' ? null : editing}
          users={users}
          onClose={() => setEditing(null)}
          onSaved={(team, isNew) => {
            setTeams((prev) => (isNew ? [...prev, team] : prev.map((t) => (t.id === team.id ? team : t))));
            setEditing(null);
          }}
          onDeleted={(id) => {
            setTeams((prev) => prev.filter((t) => t.id !== id));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function TeamEditModal({
  team,
  users,
  onClose,
  onSaved,
  onDeleted,
}: {
  team: TeamDTO | null;
  users: UserDTO[];
  onClose: () => void;
  onSaved: (team: TeamDTO, isNew: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const isNew = team === null;
  const { confirm } = useLoomiDialog();
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [color, setColor] = useState(team?.color ?? SWATCHES[0]);
  const [icon, setIcon] = useState<string | null>(team?.icon ?? null);
  const [memberIds, setMemberIds] = useState<Set<string>>(
    new Set((team?.members ?? []).map((m) => m.userId)),
  );
  const [leadIds, setLeadIds] = useState<Set<string>>(
    new Set((team?.members ?? []).filter((m) => m.role === 'lead').map((m) => m.userId)),
  );
  const [busy, setBusy] = useState(false);

  function toggleMember(id: string) {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setLeadIds((l) => {
          const nl = new Set(l);
          nl.delete(id);
          return nl;
        });
      } else {
        next.add(id);
      }
      return next;
    });
  }
  function toggleLead(id: string) {
    if (!memberIds.has(id)) return;
    setLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Team name is required');
      return;
    }
    setBusy(true);
    try {
      let saved: TeamDTO;
      if (isNew) {
        const res = await fetch('/api/teams', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: trimmed, color, icon, description: description.trim() || null }),
        });
        if (!res.ok) throw new Error();
        saved = (await res.json()).team as TeamDTO;
        // Apply staged members in a follow-up PATCH (needs the new id).
        if (memberIds.size > 0) {
          const res2 = await fetch(`/api/teams/${saved.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ memberIds: [...memberIds], leadIds: [...leadIds] }),
          });
          if (res2.ok) saved = (await res2.json()).team as TeamDTO;
        }
      } else {
        const res = await fetch(`/api/teams/${team!.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: trimmed,
            description: description.trim() || null,
            color,
            icon,
            memberIds: [...memberIds],
            leadIds: [...leadIds],
          }),
        });
        if (!res.ok) throw new Error();
        saved = (await res.json()).team as TeamDTO;
      }
      toast.success(isNew ? `Team "${saved.name}" created` : 'Team saved');
      onSaved(saved, isNew);
    } catch {
      toast.error('Could not save team');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!team) return;
    const ok = await confirm({
      title: `Archive "${team.name}"?`,
      message: 'Existing tasks keep their team tag, but it drops out of pickers.',
      confirmLabel: 'Archive',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/teams/${team.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success(`Archived "${team.name}"`);
      onDeleted(team.id);
    } catch {
      toast.error('Could not archive team');
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">
            {isNew ? 'New team' : 'Edit team'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Icon</label>
              <IconPicker
                value={icon}
                onChange={setIcon}
                fallbackIcon={<UserGroupIcon className="h-5 w-5" />}
                color={color}
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Name</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Team name"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Color</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  className="h-6 w-6 rounded-full transition"
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px var(--card), 0 0 0 4px ${c}` : undefined }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">
              Members
            </label>
            <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-xl border border-[var(--border)] p-1.5">
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
                      onClick={() => toggleMember(u.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                          isMember ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border)]'
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
                        <span className="block truncate text-xs font-medium text-[var(--foreground)]">{u.name}</span>
                        {u.department && (
                          <span className="block truncate text-[10px] text-[var(--muted-foreground)]">{u.department}</span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={!isMember}
                      onClick={() => toggleLead(u.id)}
                      title={isLead ? 'Team lead' : 'Make team lead'}
                      className="flex-shrink-0 rounded p-1 text-[var(--muted-foreground)] transition hover:text-amber-500 disabled:opacity-30"
                    >
                      {isLead ? <StarSolid className="h-4 w-4 text-amber-500" /> : <StarOutline className="h-4 w-4" />}
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
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3.5">
          {!isNew ? (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-red-500 transition hover:bg-red-500/10 disabled:opacity-50"
            >
              <TrashIcon className="h-4 w-4" />
              Archive
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm text-[var(--muted-foreground)] transition hover:bg-[var(--muted)]"
            >
              Cancel
            </button>
            <PrimaryButton onClick={save} disabled={busy || !name.trim()}>
              {isNew ? 'Create team' : 'Save'}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
