'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';
import {
  EyeIcon,
  XMarkIcon,
  ChevronUpDownIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { UserAvatar } from '@/components/user-avatar';
import { roleDisplayName } from '@/lib/roles';

interface UserEntry {
  id: string;
  name: string;
  title: string | null;
  email: string;
  role: string;
  avatarUrl: string | null;
  accountKeys: string[];
}

const roleBadgeColors: Record<string, string> = {
  developer: 'bg-purple-500/10 text-purple-400',
  super_admin: 'bg-amber-500/10 text-amber-400',
  admin: 'bg-blue-500/10 text-blue-400',
  client: 'bg-emerald-500/10 text-emerald-400',
};

export function DevImpersonate() {
  const { data: session, update } = useSession();
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [switching, setSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Fixed coords for the portal-rendered panel (so it escapes the profile
  // menu's `overflow-hidden` instead of being clipped inside it).
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const originalUserId = session?.user?.originalUserId;
  const isImpersonating = !!originalUserId;
  const isDeveloper = session?.user?.role === 'developer';

  // Only visible to developers or when currently impersonating
  const shouldShow = isDeveloper || isImpersonating;

  useEffect(() => {
    if (!shouldShow) return;

    // Fetch users for the dropdown (only developers can call this API)
    // When impersonating as non-developer, the API will 403 — that's fine, we just show the stop banner
    fetch('/api/users')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setUsers(data);
      })
      .catch(() => {});
  }, [shouldShow]);

  // Focus search when opened
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
    if (!open) setSearch('');
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      // The panel lives in a portal (outside dropdownRef), so check it too.
      if (!dropdownRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  if (!shouldShow) return null;

  const currentUserId = session?.user?.id;
  const otherUsers = users.filter((u) => {
    if (u.id === (originalUserId || currentUserId)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.title || '').toLowerCase().includes(q)
    );
  });

  // Group users by role
  const grouped: { label: string; role: string; users: UserEntry[] }[] = [
    { label: 'Super Admins', role: 'super_admin', users: otherUsers.filter((u) => u.role === 'super_admin') },
    { label: 'Admins', role: 'admin', users: otherUsers.filter((u) => u.role === 'admin') },
    { label: 'Clients', role: 'client', users: otherUsers.filter((u) => u.role === 'client') },
    { label: 'Developers', role: 'developer', users: otherUsers.filter((u) => u.role === 'developer') },
  ].filter((g) => g.users.length > 0);

  const handleImpersonate = async (userId: string) => {
    if (switching) return;
    setSwitching(true);
    setOpen(false);

    try {
      const res = await fetch('/api/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      if (!res.ok) {
        setSwitching(false);
        return;
      }

      const data = await res.json();

      await update({
        impersonateAs: {
          id: data.id,
          name: data.name,
          title: data.title,
          email: data.email,
          avatarUrl: data.avatarUrl,
          role: data.role,
          accountKeys: data.accountKeys || [],
          originalUserId: data.originalUserId,
        },
      });

      window.location.href = '/';
    } catch {
      setSwitching(false);
    }
  };

  const handleStop = async () => {
    if (switching) return;
    setSwitching(true);

    try {
      const res = await fetch('/api/impersonate', { method: 'DELETE' });

      if (!res.ok) {
        setSwitching(false);
        return;
      }

      const data = await res.json();

      await update({
        revertImpersonation: {
          id: data.id,
          name: data.name,
          title: data.title,
          email: data.email,
          avatarUrl: data.avatarUrl,
          role: data.role,
          accountKeys: data.accountKeys || [],
        },
      });

      window.location.href = '/';
    } catch {
      setSwitching(false);
    }
  };

  return (
    <div className="mt-1 border-t border-[var(--border)] pt-1">
      {/* Impersonation banner */}
      {isImpersonating && (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <EyeIcon className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-amber-400 truncate">
              Viewing as {session?.user?.name}
            </p>
            <p className="text-[10px] text-amber-300/90 truncate">{session?.user?.title || session?.user?.email}</p>
            <span className={`inline-block text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded mt-0.5 ${roleBadgeColors[session?.user?.role || ''] || 'bg-zinc-500/10 text-zinc-400'}`}>
              {roleDisplayName(session?.user?.role || '')}
            </span>
          </div>
          <button
            onClick={handleStop}
            disabled={switching}
            className="p-1 rounded-lg text-amber-400 hover:bg-amber-500/20 transition-colors flex-shrink-0 disabled:opacity-50"
            title="Stop impersonating"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Custom dropdown trigger + panel (developer, not impersonating) */}
      {isDeveloper && !isImpersonating && (
        <div ref={dropdownRef} className="relative">
          {/* Trigger button */}
          <button
            ref={triggerRef}
            onClick={() => {
              if (open) {
                setOpen(false);
                return;
              }
              const r = triggerRef.current?.getBoundingClientRect();
              if (r) setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 352) });
              setOpen(true);
            }}
            disabled={switching}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors text-left disabled:opacity-50"
          >
            <EyeIcon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
            <span className="flex-1 truncate">{switching ? 'Switching…' : 'View as…'}</span>
            <ChevronUpDownIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0" />
          </button>

          {/* Dropdown panel — portaled to body so it isn't clipped by the
              profile menu's overflow; fixed-positioned under the trigger. */}
          {open && pos &&
            createPortal(
            <div
              ref={panelRef}
              data-viewas-panel
              className="fixed z-[80] w-[22rem] glass-dropdown rounded-xl overflow-hidden animate-fade-in-up shadow-lg"
              style={{ top: pos.top, left: pos.left, maxWidth: 'calc(100vw - 1rem)' }}
            >
              {/* Search */}
              <div className="p-1.5 border-b border-[var(--border)]">
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search users..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              <div className="max-h-[300px] overflow-y-auto p-1">
                {grouped.map((group, gi) => (
                  <div key={group.role}>
                    {gi > 0 && <div className="mx-2 my-1 border-t border-[var(--border)]" />}
                    <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      {group.label}
                    </p>
                    {group.users.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => handleImpersonate(u.id)}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-[var(--muted)] transition-colors"
                      >
                        <UserAvatar
                          name={u.name}
                          email={u.email}
                          avatarUrl={u.avatarUrl}
                          size={28}
                          className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[var(--foreground)] truncate">
                            {u.name}
                          </p>
                          <p className="text-[10px] text-[var(--muted-foreground)] truncate leading-tight">
                            {u.title || u.email}
                          </p>
                        </div>
                        <span className={`text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0 ${roleBadgeColors[u.role] || 'bg-zinc-500/10 text-zinc-400'}`}>
                          {roleDisplayName(u.role)}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}

                {grouped.length === 0 && (
                  <p className="text-xs text-[var(--muted-foreground)] text-center py-4">
                    No other users found
                  </p>
                )}
              </div>
            </div>,
              document.body,
            )}
        </div>
      )}
    </div>
  );
}
