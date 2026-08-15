'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ElevatedOnly } from '@/components/route-guard';
import { AccountAssignmentManager } from '@/components/account-assignment-manager';
import { useAccount } from '@/contexts/account-context';
import { toast } from '@/lib/toast';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import PrimaryButton from '@/components/primary-button';

/** The routed page at /users/new (and its /settings/users/new mirror). */
export function NewUserPage() {
  return (
    <ElevatedOnly>
      <NewUserContent />
    </ElevatedOnly>
  );
}

/**
 * The same form, embedded rather than routed — used by the Agency Settings
 * modal so "Add User" stays inside the overlay. `onCancel` replaces the back
 * link and `onCreated` replaces the redirect to the new user's page.
 */
export function NewUser({
  onCancel,
  onCreated,
  defaultRole,
}: {
  onCancel: () => void;
  onCreated: (userId: string) => void;
  /** Starting role. Agency Settings passes `admin` — it lists agency staff, so
   *  a user created there defaulting to Client would vanish on save. */
  defaultRole?: string;
}) {
  return (
    <ElevatedOnly>
      <NewUserContent onCancel={onCancel} onCreated={onCreated} defaultRole={defaultRole} />
    </ElevatedOnly>
  );
}

function NewUserContent({
  onCancel,
  onCreated,
  defaultRole,
}: {
  onCancel?: () => void;
  onCreated?: (userId: string) => void;
  defaultRole?: string;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const { accounts, accountsLoaded, userRole } = useAccount();
  const usersBasePath = pathname.startsWith('/settings/users') ? '/settings/users' : '/users';

  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const [role, setRole] = useState(defaultRole ?? 'client');
  const [department, setDepartment] = useState('');
  const [accountKeys, setAccountKeys] = useState<string[]>([]);

  const DEPARTMENTS = [
    'Web Development',
    'Digital',
    'Graphic Design',
    'Account Representative',
  ];

  const handleCreate = async () => {
    if (!sendInvite && !password) {
      toast.error('Password is required');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name,
        title,
        email,
        role,
        department: department || null,
        accountKeys,
        sendInvite,
      };
      if (!sendInvite) body.password = password;

      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create user');
      }
      const user = await res.json();
      if (sendInvite) {
        if (user?.invite?.sent) {
          toast.success('User created and invite email sent');
        } else {
          toast.error(user?.invite?.error || 'User created, but invite email could not be sent');
        }
      } else {
        toast.success('User created');
      }
      if (onCreated) onCreated(user.id);
      else router.push(`${usersBasePath}/${user.id}`);
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--primary)]';
  const labelClass = 'block text-xs font-medium text-[var(--muted-foreground)] mb-1.5';
  const sectionHeadingClass = 'text-sm font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-4';
  const sectionCardClass = 'glass-section-card rounded-xl p-6';

  return (
    <div>
      {/* Header */}
      <div className="page-sticky-header flex items-center gap-3 mb-8">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Back to Users"
            className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4" />
          </button>
        ) : (
          <Link
            href={usersBasePath}
            className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4" />
          </Link>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold">New User</h2>
          <p className="text-xs text-[var(--muted-foreground)]">Create a new team member account</p>
        </div>
        <PrimaryButton
          onClick={handleCreate}
          disabled={saving || !name || !email || (!sendInvite && !password)}
        >
          {saving ? 'Creating...' : sendInvite ? 'Create & Send Invite' : 'Create User'}
        </PrimaryButton>
      </div>

      <div className="max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* General */}
        <section className={sectionCardClass}>
          <h3 className={sectionHeadingClass}>General</h3>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputClass} autoFocus />
            </div>
            <div>
              <label className={labelClass}>Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className={inputClass}
                placeholder="e.g. Marketing Manager"
              />
            </div>
            <div>
              <label className={labelClass}>Department</label>
              <select
                value={department}
                onChange={e => setDepartment(e.target.value)}
                className={inputClass}
              >
                <option value="">— No department —</option>
                {DEPARTMENTS.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputClass} />
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3.5">
              <label className={`${labelClass} mb-2`}>Onboarding</label>
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={sendInvite}
                  onChange={(e) => setSendInvite(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[var(--border)] bg-[var(--input)]"
                />
                <span className="text-[var(--foreground)]">
                  Send invite email so the user creates their own password
                  <span className="block text-xs text-[var(--muted-foreground)] mt-0.5">
                    Recommended for team onboarding.
                  </span>
                </span>
              </label>
            </div>
            {!sendInvite && (
              <div>
                <label className={labelClass}>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className={inputClass}
                />
              </div>
            )}
          </div>
        </section>

        {/* Role & Access */}
        <section className={sectionCardClass}>
          <h3 className={sectionHeadingClass}>Role & Access</h3>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Role</label>
              <select value={role} onChange={e => setRole(e.target.value)} className={inputClass}>
                {userRole === 'developer' && <option value="developer">Developer</option>}
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
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
