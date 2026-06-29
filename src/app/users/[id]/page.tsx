'use client';

import { useState, useEffect, useMemo, useRef, type ChangeEvent } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AdminOnly } from '@/components/route-guard';
import { AccountAssignmentManager } from '@/components/account-assignment-manager';
import { useAccount } from '@/contexts/account-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { UserAvatar } from '@/components/user-avatar';
import { MultiSelect } from '@/components/ui/multi-select';
import { roleDisplayName } from '@/lib/roles';
import { safeJson } from '@/lib/safe-json';
import { toast } from '@/lib/toast';
import { ArrowLeftIcon, ArrowUpTrayIcon, TrashIcon } from '@heroicons/react/24/outline';
import PrimaryButton from '@/components/primary-button';

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

interface User {
  id: string;
  name: string;
  title: string | null;
  email: string;
  avatarUrl: string | null;
  role: string;
  department: string | null;
  teamIds: string[];
  accountKeys: string[];
  createdAt: string;
}

type TeamOption = { id: string; name: string; color: string | null };

const roleColors: Record<string, string> = {
  developer: 'text-purple-400 bg-purple-500/10',
  super_admin: 'text-amber-400 bg-amber-500/10',
  admin: 'text-blue-400 bg-blue-500/10',
  client: 'text-green-400 bg-green-500/10',
};

export default function UserDetailPage() {
  return (
    <AdminOnly>
      <UserDetailContent />
    </AdminOnly>
  );
}

function UserDetailContent() {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, update } = useSession();
  const userId = params.id as string;
  const { accounts, accountsLoaded, userRole: currentUserRole } = useAccount();
  const { markClean } = useUnsavedChanges();
  const { confirm } = useLoomiDialog();
  const canEditUsers = currentUserRole === 'developer' || currentUserRole === 'super_admin';
  const canUploadAvatar = currentUserRole === 'developer';
  const usersBasePath = pathname.startsWith('/settings/users') ? '/settings/users' : '/users';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('client');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [teamOptions, setTeamOptions] = useState<TeamOption[]>([]);
  const [accountKeys, setAccountKeys] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Team options for the Teams picker (the delivery teams this user can join).
  useEffect(() => {
    fetch('/api/teams')
      .then((r) => (r.ok ? r.json() : { teams: [] }))
      .then((d: { teams?: { id: string; name: string; color: string | null }[] }) => {
        setTeamOptions((d.teams ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color })));
      })
      .catch(() => setTeamOptions([]));
  }, []);

  useEffect(() => {
    fetch(`/api/users/${userId}`)
      .then(r => {
        if (!r.ok) throw new Error('not found');
        return r.json();
      })
      .then((data: User) => {
        setUser(data);
        setName(data.name);
        setTitle(data.title ?? '');
        setEmail(data.email);
        setAvatarUrl(data.avatarUrl ?? null);
        setRole(data.role);
        setTeamIds(data.teamIds ?? []);
        setAccountKeys(data.accountKeys || []);
        userSnapshotRef.current = {
          name: data.name,
          title: data.title ?? '',
          email: data.email,
          role: data.role,
          teamIds: JSON.stringify(data.teamIds ?? []),
          accountKeys: JSON.stringify(data.accountKeys || []),
        };
      })
      .catch(() => toast.error('User not found'))
      .finally(() => setLoading(false));
  }, [userId]);

  const userSnapshotRef = useRef<Record<string, string> | null>(null);

  const hasChanges = useMemo(() => {
    const snap = userSnapshotRef.current;
    if (!snap) return false;
    const current: Record<string, string> = {
      name, title, email, role,
      teamIds: JSON.stringify(teamIds),
      accountKeys: JSON.stringify(accountKeys),
    };
    // Password is additive — any non-empty password counts as a change
    if (password.length > 0) return true;
    return Object.keys(snap).some(k => snap[k] !== current[k]);
  }, [name, title, email, role, teamIds, accountKeys, password]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        id: userId,
        name,
        title,
        email,
        role,
        teamIds,
        accountKeys,
      };
      if (password) body.password = password;

      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const { ok: saveOk, data: updated, error: saveError } = await safeJson<User>(res);
      if (!saveOk || !updated) {
        throw new Error(saveError || 'Failed to update user');
      }
      setUser(updated);
      setName(updated.name);
      setTitle(updated.title ?? '');
      setEmail(updated.email);
      setRole(updated.role);
      setTeamIds(updated.teamIds ?? []);
      setAccountKeys(updated.accountKeys || []);
      setPassword('');
      userSnapshotRef.current = {
        name: updated.name,
        title: updated.title ?? '',
        email: updated.email,
        role: updated.role,
        teamIds: JSON.stringify(updated.teamIds ?? []),
        accountKeys: JSON.stringify(updated.accountKeys || []),
      };
      if (session?.user.id === userId) {
        await update({
          name: updated.name,
          email: updated.email,
          title: updated.title ?? null,
          role: updated.role,
          accountKeys: updated.accountKeys,
        });
        router.refresh();
      }
      markClean();
      toast.success('User updated');
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete User',
      message: `Delete "${name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/users?id=${userId}`, { method: 'DELETE' });
      const { ok: delOk, error: delError } = await safeJson(res);
      if (!delOk) {
        throw new Error(delError || 'Failed to delete');
      }
      toast.success('User deleted');
      router.push(usersBasePath);
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err));
    }
  };

  const handleSendInvite = async () => {
    setSendingInvite(true);
    try {
      const res = await fetch('/api/users/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const { ok: invOk, error: invError } = await safeJson(res);
      if (!invOk) {
        throw new Error(invError || 'Failed to send invite');
      }
      toast.success('Invite email sent');
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err));
    } finally {
      setSendingInvite(false);
    }
  };

  async function handleAvatarUpload(file: File) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Please upload PNG, JPG, or WebP');
      return;
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      toast.error('Image must be 5MB or smaller');
      return;
    }

    setAvatarLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`/api/users/${userId}/avatar`, {
        method: 'POST',
        body: formData,
      });
      const { ok, data, error } = await safeJson<{ avatarUrl: string }>(res);
      if (!ok || !data) {
        throw new Error(error || 'Upload failed');
      }

      setAvatarUrl(data.avatarUrl);
      setUser(prev => prev ? { ...prev, avatarUrl: data.avatarUrl } : prev);
      if (session?.user.id === userId) {
        await update({ avatarUrl: data.avatarUrl });
      }
      toast.success('Profile photo updated');
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err));
    } finally {
      setAvatarLoading(false);
    }
  }

  async function handleAvatarInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await handleAvatarUpload(file);
  }

  async function handleRemoveAvatar() {
    setAvatarLoading(true);
    try {
      const res = await fetch(`/api/users/${userId}/avatar`, { method: 'DELETE' });
      const { ok, error } = await safeJson(res);
      if (!ok) {
        throw new Error(error || 'Could not remove photo');
      }

      setAvatarUrl(null);
      setUser(prev => prev ? { ...prev, avatarUrl: null } : prev);
      if (session?.user.id === userId) {
        await update({ avatarUrl: null });
      }
      toast.success('Profile photo removed');
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err));
    } finally {
      setAvatarLoading(false);
    }
  }

  if (loading) {
    return <div className="text-[var(--muted-foreground)]">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="text-center py-16">
        <p className="text-[var(--muted-foreground)]">User not found</p>
        <Link href={usersBasePath} className="text-sm text-[var(--primary)] mt-2 inline-block hover:underline">
          Back to Users
        </Link>
      </div>
    );
  }

  const inputClass = 'w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]';
  const labelClass = 'block text-xs font-medium text-[var(--muted-foreground)] mb-1.5';
  const sectionHeadingClass = 'text-sm font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4';
  const sectionCardClass = 'glass-section-card rounded-xl p-6';

  return (
    <div>
      {/* Header */}
      <div className="page-sticky-header flex items-center gap-3 mb-8">
        <Link
          href={usersBasePath}
          className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" />
        </Link>
        <div className="relative">
          <UserAvatar
            name={name || user.name}
            email={email || user.email}
            avatarUrl={avatarUrl}
            size={56}
            className="w-14 h-14 rounded-full object-cover"
          />
          {avatarLoading && (
            <div className="absolute inset-0 rounded-full bg-black/30 flex items-center justify-center">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold truncate">{name || user.name}</h2>
          {(title || user.title) && (
            <p className="text-sm text-[var(--muted-foreground)] truncate">{title || user.title}</p>
          )}
          <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <span>{email || user.email}</span>
            <span className={`text-[10px] font-medium uppercase tracking-wider rounded px-1.5 py-0.5 ${roleColors[user.role] || ''}`}>
              {roleDisplayName(user.role)}
            </span>
          </div>
        </div>
        {canEditUsers && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleSendInvite}
              disabled={sendingInvite}
              className="px-3.5 py-2 border border-[var(--border)] rounded-lg text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-50 transition-colors"
            >
              {sendingInvite ? 'Sending...' : 'Send Invite'}
            </button>
            <PrimaryButton
              onClick={handleSave}
              disabled={saving || !name || !email || !hasChanges}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </PrimaryButton>
          </div>
        )}
      </div>

      <div className={'max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-6' + (!canEditUsers ? ' opacity-70 pointer-events-none' : '')}>

        {/* General */}
        <section className={sectionCardClass}>
          <h3 className={sectionHeadingClass}>General</h3>
          <div className="space-y-4">
            {canUploadAvatar && (
              <div>
                <label className={labelClass}>Profile Photo</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  className="hidden"
                  onChange={handleAvatarInputChange}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={avatarLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
                  >
                    <ArrowUpTrayIcon className="w-3.5 h-3.5" />
                    {avatarLoading ? 'Updating...' : avatarUrl ? 'Change Photo' : 'Upload Photo'}
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={handleRemoveAvatar}
                      disabled={avatarLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  )}
                </div>
              </div>
            )}
            <div>
              <label className={labelClass}>Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Marketing Manager"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Teams</label>
              <MultiSelect
                value={teamIds}
                onChange={setTeamIds}
                options={teamOptions.map((t) => ({
                  value: t.id,
                  label: t.name,
                  icon: (
                    <span
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: t.color || 'var(--primary)' }}
                    />
                  ),
                }))}
                placeholder="Add to a team…"
              />
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Delivery teams this person is on. Tickets routed to a team reach its members.
              </p>
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>
                Password <span className="text-[var(--muted-foreground)] font-normal">(leave blank to keep current)</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Leave blank to keep current"
                className={inputClass}
              />
            </div>
          </div>
        </section>

        {/* Role & Access */}
        <section className={sectionCardClass}>
          <h3 className={sectionHeadingClass}>Role & Access</h3>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Role</label>
              <select value={role} onChange={e => setRole(e.target.value)} className={inputClass}>
                {currentUserRole === 'developer' && <option value="developer">Developer</option>}
                <option value="super_admin">Super Admin</option>
                <option value="admin">Admin</option>
                <option value="client">Client</option>
              </select>
            </div>

            {(role === 'admin' || role === 'client') && (
              <div>
                <label className={labelClass}>Assigned Accounts</label>
                <AccountAssignmentManager
                  accounts={accounts}
                  accountsLoaded={accountsLoaded}
                  selectedKeys={accountKeys}
                  onChange={setAccountKeys}
                  description={role === 'admin' ? 'Admin can switch between these accounts' : 'Client will be locked to these accounts'}
                  disabled={!canEditUsers}
                />
              </div>
            )}
          </div>
        </section>

        {/* Info */}
        <section className={`${sectionCardClass} lg:col-span-2`}>
          <h3 className={sectionHeadingClass}>Info</h3>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>User ID</label>
              <div className="px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)] font-mono">
                {user.id}
              </div>
            </div>
            <div>
              <label className={labelClass}>Created</label>
              <div className="px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]">
                {new Date(user.createdAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Danger Zone */}
      </div>

      {/* Danger Zone — outside fieldset so it's not disabled */}
      {canEditUsers && (
        <div className="max-w-7xl mt-6">
          <section className="glass-section-card rounded-xl p-6 border border-red-500/20">
            <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-3">Danger Zone</h3>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-4 border border-red-500/20 rounded-xl">
              <div>
                <p className="text-sm font-medium">Delete this user</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Permanently remove {name} and revoke their access.
                </p>
              </div>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors flex-shrink-0"
              >
                Delete User
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
