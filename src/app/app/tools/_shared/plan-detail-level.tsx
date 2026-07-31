'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * How much of the plan surface a user wants to see.
 *
 * 'basic'    — planning + budget only. Hides the creative-workflow fields
 *              (Creative & Design, Approvals) in the editor and their Design /
 *              Approvals columns in the plan table.
 * 'detailed' — everything, i.e. the full designer/reviewer workflow.
 *
 * Basic is the default: most reps only plan budgets and flights, and the
 * design/approval columns are noise for them.
 */
export type PlanDetailLevel = 'basic' | 'detailed';

const STORAGE_KEY = 'loomi.planner.detailLevel';

/**
 * Sticky plan detail-level preference. One shared localStorage key across the
 * Meta + Google planners so the choice follows the user between tools (it's a
 * statement about the user's role, not about a platform). Falls back to
 * 'basic' when nothing is stored or storage is unavailable (SSR, private mode).
 */
export function usePlanDetailLevel(): [
  PlanDetailLevel,
  (next: PlanDetailLevel) => void,
] {
  const [level, setLevel] = useState<PlanDetailLevel>('basic');

  // Read after mount so the server render matches the static default and we
  // don't trip a hydration mismatch.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'basic' || stored === 'detailed') setLevel(stored);
    } catch {
      // Storage blocked — stay on the default.
    }
  }, []);

  const update = useCallback((next: PlanDetailLevel) => {
    setLevel(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Best-effort persistence.
    }
  }, []);

  return [level, update];
}

const OPTIONS: Array<{ value: PlanDetailLevel; label: string }> = [
  { value: 'basic', label: 'Basic' },
  { value: 'detailed', label: 'Detailed' },
];

/** Basic / Detailed segmented control for the plan table + ad editor. */
export function PlanDetailToggle({
  value,
  onChange,
  className = '',
}: {
  value: PlanDetailLevel;
  onChange: (next: PlanDetailLevel) => void;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5 ${className}`}
      role="group"
      aria-label="Plan detail level"
    >
      {OPTIONS.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-[var(--muted)] text-[var(--foreground)]'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
