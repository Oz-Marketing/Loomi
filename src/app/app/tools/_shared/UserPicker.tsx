'use client';

import { useMemo, useState } from 'react';
import type { DirectoryUser } from '@/lib/ad-pacer/types';
import { USER_DEPT_FILTERS } from '@/lib/ad-pacer/constants';
import { inputClass } from './inputs';

/**
 * Department-filtered role picker. Each role pre-filters the directory to people
 * in its allowed departments (USER_DEPT_FILTERS), with a "Show all users" toggle
 * to fall back to the full list. A currently-selected user outside the filter is
 * always kept visible.
 */
export function UserPicker({
  users,
  value,
  onChange,
  filterFor,
  placeholder = '— Unassigned —',
}: {
  users: DirectoryUser[];
  value: string | null;
  onChange: (v: string | null) => void;
  filterFor: keyof typeof USER_DEPT_FILTERS;
  placeholder?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const allowedDepts = USER_DEPT_FILTERS[filterFor];

  const filteredUsers = useMemo(() => {
    const matched = users.filter((u) =>
      u.department ? (allowedDepts as readonly string[]).includes(u.department) : false,
    );
    return showAll ? users : matched;
  }, [users, showAll, allowedDepts]);

  // If selected user isn't in filtered list, ensure they still render
  const selected = users.find((u) => u.id === value);
  const finalList = useMemo(() => {
    if (selected && !filteredUsers.some((u) => u.id === selected.id)) {
      return [selected, ...filteredUsers];
    }
    return filteredUsers;
  }, [selected, filteredUsers]);

  return (
    <div className="space-y-1.5">
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={inputClass}
      >
        <option value="">{placeholder}</option>
        {finalList.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
            {u.department ? ` · ${u.department}` : ''}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setShowAll((p) => !p)}
        className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
      >
        {showAll ? 'Showing all users · filter to department' : 'Show all users'}
      </button>
    </div>
  );
}
