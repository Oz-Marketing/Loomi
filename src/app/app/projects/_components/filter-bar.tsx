'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  FunnelIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { AccountAvatar } from '@/components/account-avatar';
import { UserAvatar } from '@/components/user-avatar';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select';
import { STATUSES, PRIORITY_META, type PriorityKey } from '@/lib/projects/ui';
import type { ProjectOptions } from './use-project-options';

const PRIORITIES: PriorityKey[] = ['urgent', 'high', 'medium', 'low'];

/** All per-view task filters. Empty array = no filter for that facet. */
export type TaskFilters = {
  accountKeys: string[];
  teamKeys: string[];
  assigneeUserIds: string[];
  priorities: string[];
  statuses: string[];
  search: string;
};

function Dot({ color }: { color: string }) {
  return <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

/**
 * Tasks/Calendar toolbar. Title + description on the left, the New ticket CTA
 * on the right. A second row holds the (optional) Board/Table toggle, a search
 * box, and a Filters popover — the account/team/assignee/priority/status
 * pickers live behind the funnel so the header stays clean. Every picker is a
 * Loomi MultiSelect (avatars/logos + search), never a native select.
 */
export function ProjectsFilterBar({
  options,
  accountKeys,
  teamKeys,
  onAccountKeys,
  onTeamKeys,
  assigneeUserIds,
  onAssigneeUserIds,
  priorities,
  onPriorities,
  statuses,
  onStatuses,
  title,
  subtitle,
  showAccountSelect = true,
  viewToggle,
  search,
  onSearch,
}: {
  options: ProjectOptions | undefined;
  accountKeys: string[];
  teamKeys: string[];
  onAccountKeys: (v: string[]) => void;
  onTeamKeys: (v: string[]) => void;
  assigneeUserIds?: string[];
  onAssigneeUserIds?: (v: string[]) => void;
  priorities?: string[];
  onPriorities?: (v: string[]) => void;
  statuses?: string[];
  onStatuses?: (v: string[]) => void;
  title: string;
  subtitle?: string;
  /** Hide the per-view account picker when the global selector locks the account. */
  showAccountSelect?: boolean;
  /** Optional segmented control (e.g. Board/Table). */
  viewToggle?: React.ReactNode;
  /** Optional client-side search box. Rendered only when onSearch is provided. */
  search?: string;
  onSearch?: (v: string) => void;
}) {
  return (
    <div className="pt-6 pb-4">
      {/* Title + description, CTA pinned right */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--foreground)]">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-[var(--muted-foreground)]">{subtitle}</p>}
        </div>
        <Link
          href="/projects/new"
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3.5 py-2 text-sm font-medium text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)] transition hover:opacity-90"
        >
          <PlusIcon className="h-4 w-4" />
          New ticket
        </Link>
      </div>

      {/* Controls: toggle · search · filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {viewToggle}
        {onSearch && (
          <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search ?? ''}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search tasks…"
              aria-label="Search tasks"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--input)] py-2 pl-9 pr-8 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        <FilterPopover
          options={options}
          accountKeys={accountKeys}
          teamKeys={teamKeys}
          onAccountKeys={onAccountKeys}
          onTeamKeys={onTeamKeys}
          assigneeUserIds={assigneeUserIds}
          onAssigneeUserIds={onAssigneeUserIds}
          priorities={priorities}
          onPriorities={onPriorities}
          statuses={statuses}
          onStatuses={onStatuses}
          showAccountSelect={showAccountSelect}
        />
      </div>
    </div>
  );
}

function FilterPopover({
  options,
  accountKeys,
  teamKeys,
  onAccountKeys,
  onTeamKeys,
  assigneeUserIds,
  onAssigneeUserIds,
  priorities,
  onPriorities,
  statuses,
  onStatuses,
  showAccountSelect,
}: {
  options: ProjectOptions | undefined;
  accountKeys: string[];
  teamKeys: string[];
  onAccountKeys: (v: string[]) => void;
  onTeamKeys: (v: string[]) => void;
  assigneeUserIds?: string[];
  onAssigneeUserIds?: (v: string[]) => void;
  priorities?: string[];
  onPriorities?: (v: string[]) => void;
  statuses?: string[];
  onStatuses?: (v: string[]) => void;
  showAccountSelect: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape. Ignore clicks inside a MultiSelect's
  // portaled dropdown (it lives on document.body, outside this popover).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t)) return;
      if (t.closest('[data-builder-popout-portal]')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus(); // return focus to the trigger
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Move focus into the panel when it opens (keyboard users land inside it).
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const activeCount =
    (showAccountSelect ? accountKeys.length : 0) +
    teamKeys.length +
    (onAssigneeUserIds ? (assigneeUserIds?.length ?? 0) : 0) +
    (onPriorities ? (priorities?.length ?? 0) : 0) +
    (onStatuses ? (statuses?.length ?? 0) : 0);

  function clearAll() {
    if (showAccountSelect) onAccountKeys([]);
    onTeamKeys([]);
    onAssigneeUserIds?.([]);
    onPriorities?.([]);
    onStatuses?.([]);
  }

  const accountOptions: MultiSelectOption[] = (options?.accounts ?? []).map((a) => ({
    value: a.key,
    label: a.dealer,
    icon: (
      <AccountAvatar
        name={a.dealer}
        accountKey={a.key}
        logos={a.logos ?? undefined}
        size={18}
        className="h-[18px] w-[18px] flex-shrink-0 rounded object-cover"
      />
    ),
  }));

  const teamOptions: MultiSelectOption[] = (options?.teams ?? []).map((t) => ({
    value: t.key,
    label: t.name,
    icon: <Dot color={t.color ?? 'var(--primary)'} />,
  }));

  const assigneeOptions: MultiSelectOption[] = [
    { value: '__unassigned__', label: 'Unassigned' },
    ...(options?.users ?? []).map((u) => ({
      value: u.id,
      label: u.name,
      icon: (
        <UserAvatar
          name={u.name}
          email={u.email}
          avatarUrl={u.avatarUrl}
          size={18}
          className="h-[18px] w-[18px] flex-shrink-0 rounded-full object-cover"
        />
      ),
    })),
  ];

  const priorityOptions: MultiSelectOption[] = PRIORITIES.map((p) => ({
    value: p,
    label: PRIORITY_META[p].label,
    icon: <Dot color={PRIORITY_META[p].color} />,
  }));

  const statusOptions: MultiSelectOption[] = STATUSES.map((s) => ({
    value: s.key,
    label: s.label,
    icon: <Dot color={s.dot} />,
  }));

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition ${
          activeCount > 0 || open
            ? 'border-[var(--primary)] text-[var(--primary)]'
            : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
        }`}
      >
        <FunnelIcon className="h-4 w-4" />
        Filters
        {activeCount > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[11px] font-semibold text-white">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Task filters"
          tabIndex={-1}
          className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--card-strong)] p-3 shadow-xl outline-none backdrop-blur-2xl backdrop-saturate-150"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Filters
            </span>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-xs font-medium text-[var(--primary)] hover:opacity-80"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="space-y-2.5">
            {showAccountSelect && (
              <Field label="Account">
                <MultiSelect
                  value={accountKeys}
                  onChange={onAccountKeys}
                  options={accountOptions}
                  placeholder="All accounts"
                />
              </Field>
            )}
            <Field label="Team">
              <MultiSelect
                value={teamKeys}
                onChange={onTeamKeys}
                options={teamOptions}
                placeholder="All teams"
              />
            </Field>
            {onAssigneeUserIds && (
              <Field label="Assignee">
                <MultiSelect
                  value={assigneeUserIds ?? []}
                  onChange={onAssigneeUserIds}
                  options={assigneeOptions}
                  placeholder="Anyone"
                />
              </Field>
            )}
            {onPriorities && (
              <Field label="Priority">
                <MultiSelect
                  value={priorities ?? []}
                  onChange={onPriorities}
                  options={priorityOptions}
                  placeholder="All priorities"
                />
              </Field>
            )}
            {onStatuses && (
              <Field label="Status">
                <MultiSelect
                  value={statuses ?? []}
                  onChange={onStatuses}
                  options={statusOptions}
                  placeholder="All statuses"
                />
              </Field>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-medium text-[var(--muted-foreground)]">{label}</span>
      {children}
    </div>
  );
}

/** Client-side predicate matching the multi-select filters + search. */
export function matchesFilters(
  t: {
    accountKey?: string;
    teamKey?: string | null;
    assignee: { id: string; name?: string | null } | null;
    priority: string;
    status: string;
    title?: string;
    accountDealer?: string | null;
    teamName?: string | null;
  },
  f: Partial<TaskFilters>,
): boolean {
  if (f.accountKeys?.length && !(t.accountKey && f.accountKeys.includes(t.accountKey))) return false;
  if (f.teamKeys?.length && !(t.teamKey && f.teamKeys.includes(t.teamKey))) return false;
  if (f.assigneeUserIds?.length) {
    const wantUnassigned = f.assigneeUserIds.includes('__unassigned__');
    const matchUser = !!t.assignee && f.assigneeUserIds.includes(t.assignee.id);
    const matchUnassigned = wantUnassigned && !t.assignee;
    if (!matchUser && !matchUnassigned) return false;
  }
  if (f.priorities?.length && !f.priorities.includes(t.priority)) return false;
  if (f.statuses?.length && !f.statuses.includes(t.status)) return false;
  if (f.search) {
    const q = f.search.trim().toLowerCase();
    if (q) {
      const hay = [t.title, t.accountDealer, t.teamName, t.assignee?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }
  return true;
}
