'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowPathIcon, FunnelIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { DirectoryUser, PacerAd } from '@/lib/ad-pacer/types';
import { AD_STATUSES, ACTIVE_STATUSES, COLORS } from '@/lib/ad-pacer/constants';
import { budgetTypeColor } from '@/lib/ad-pacer/helpers';
import {
  type PlanFilters,
  EMPTY_FILTERS,
  activeFilterCount,
  isAdOverdue,
} from '@/lib/ad-pacer/filters';

// Meta planner/pacer filter UI: status-indicator chip + slide-from-right
// sidebar. Split out of MetaAdsPlannerTool to shrink the file.
function FilterChip({
  active,
  onClick,
  children,
  count,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
  color?: string;
}) {
  const accent = color ?? 'var(--primary)';
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-full border transition-colors"
      style={{
        borderColor: active ? accent : 'var(--sidebar-border-soft)',
        background: active ? `${accent}1f` : 'transparent',
        color: active ? accent : 'var(--sidebar-muted-foreground)',
      }}
    >
      {children}
      {typeof count === 'number' && (
        <span
          className="text-[10px] font-semibold rounded-full px-1.5"
          style={{
            background: active ? `${accent}33` : 'var(--sidebar-muted)',
            color: active ? accent : 'var(--sidebar-muted-foreground)',
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Slim status row shown above the ad list inside each panel. */
export function FilterStatus({
  filters,
  onClear,
  filteredCount,
  totalCount,
}: {
  filters: PlanFilters;
  onClear: () => void;
  filteredCount: number;
  totalCount: number;
}) {
  const active = activeFilterCount(filters);
  return (
    <div className="flex items-center justify-between gap-3 mb-3 text-[11px] text-[var(--muted-foreground)]">
      <div className="flex items-center gap-2">
        <span>
          Showing{' '}
          <span className="text-[var(--foreground)] font-semibold">{filteredCount}</span>{' '}
          of{' '}
          <span className="text-[var(--foreground)] font-semibold">{totalCount}</span>{' '}
          ad{totalCount !== 1 ? 's' : ''}
        </span>
        {active > 0 && (
          <>
            <span className="text-[var(--border)]">·</span>
            <span>
              {active} filter{active !== 1 ? 's' : ''} active
            </span>
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              <ArrowPathIcon className="w-3 h-3" />
              Clear
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Filter sidebar — inline right-rail (FlowFilterSidebar pattern). Pass
 * `inline` so the parent grid lays it out alongside content rather than
 * over it; `className` controls open/closed slide animation.
 */
export function MetaAdsPacerFilterSidebar({
  open,
  onClose,
  inline = false,
  className = '',
  filters,
  onChange,
  users,
  ads,
  currentUserId,
}: {
  open: boolean;
  onClose: () => void;
  inline?: boolean;
  className?: string;
  filters: PlanFilters;
  onChange: (next: PlanFilters) => void;
  users: DirectoryUser[];
  ads: PacerAd[];
  currentUserId: string | null;
}) {
  useEffect(() => {
    if (inline || !open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [inline, open, onClose]);

  const counts = useMemo(() => {
    const mine = currentUserId
      ? ads.filter(
          (a) =>
            a.ownerUserId === currentUserId ||
            a.designerUserId === currentUserId ||
            a.accountRepUserId === currentUserId,
        ).length
      : 0;
    const overdue = ads.filter(isAdOverdue).length;
    const needsApproval = ads.filter(
      (a) =>
        a.internalApproval === 'Pending Approval' ||
        a.clientApproval === 'Pending Approval',
    ).length;
    const active = ads.filter((a) => ACTIVE_STATUSES.includes(a.adStatus)).length;
    return { mine, overdue, needsApproval, active };
  }, [ads, currentUserId]);

  // Account-rep candidates = users actually assigned to ads in this plan.
  const accountRepUsers = useMemo(() => {
    const repIds = new Set(
      ads.map((a) => a.accountRepUserId).filter((id): id is string => !!id),
    );
    return users.filter((u) => repIds.has(u.id));
  }, [users, ads]);

  // Always render in inline mode so the grid layout can animate it; in
  // overlay mode we keep the previous "render only when open" behavior.
  if (!inline && !open) return null;
  if (!inline && typeof document === 'undefined') return null;
  const active = activeFilterCount(filters);
  const sidebarInputClass =
    'w-full px-3 py-2 text-sm rounded-lg border border-[var(--sidebar-border-soft)] bg-[var(--sidebar-input)]/60 text-[var(--sidebar-foreground)] focus:outline-none focus:border-[var(--primary)]/60 focus:ring-1 focus:ring-[var(--primary)]/30';
  const sectionLabelClass =
    'text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted-foreground)]';

  const panel = (
    <aside
      className={
        inline
          ? `rounded-2xl text-[var(--sidebar-foreground)] flex flex-col overflow-hidden ${className}`.trim()
          : 'glass-panel glass-panel-strong fixed right-3 top-3 bottom-3 w-[360px] rounded-2xl flex flex-col overflow-hidden'
      }
    >
        <div className="p-5 border-b border-[var(--sidebar-border-soft)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FunnelIcon className="w-5 h-5 text-black dark:text-[var(--primary)]" />
            <h3 className="text-sm font-bold tracking-tight">Filters</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-muted)] transition-colors"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="themed-scrollbar flex-1 overflow-y-auto p-4 space-y-5">
          {/* Quick views */}
          <section className="space-y-2.5">
            <p className={sectionLabelClass}>Quick views</p>
            <div className="flex flex-wrap gap-1.5">
              {currentUserId && (
                <FilterChip
                  active={filters.showMine}
                  onClick={() => onChange({ ...filters, showMine: !filters.showMine })}
                  count={counts.mine}
                >
                  Mine
                </FilterChip>
              )}
              <FilterChip
                active={filters.showOverdue}
                onClick={() => onChange({ ...filters, showOverdue: !filters.showOverdue })}
                count={counts.overdue}
                color={COLORS.error}
              >
                Overdue
              </FilterChip>
              <FilterChip
                active={filters.showNeedsApproval}
                onClick={() =>
                  onChange({ ...filters, showNeedsApproval: !filters.showNeedsApproval })
                }
                count={counts.needsApproval}
                color={COLORS.warn}
              >
                Needs Approval
              </FilterChip>
              <FilterChip
                active={filters.showActive}
                onClick={() => onChange({ ...filters, showActive: !filters.showActive })}
                count={counts.active}
                color={COLORS.success}
              >
                Active
              </FilterChip>
            </div>
          </section>

          {/* Status */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className={sectionLabelClass}>Ad status</p>
              {filters.status && (
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, status: null })}
                  className="text-[10px] font-medium text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <select
              value={filters.status ?? ''}
              onChange={(e) =>
                onChange({ ...filters, status: e.target.value || null })
              }
              className={sidebarInputClass}
            >
              <option value="">All statuses</option>
              {AD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </section>

          {/* Source */}
          <section className="space-y-2.5">
            <p className={sectionLabelClass}>Budget source</p>
            <div className="flex rounded-lg border border-[var(--sidebar-border-soft)] bg-[var(--sidebar-input)]/60 overflow-hidden">
              {(['all', 'base', 'added'] as const).map((s) => {
                const isActive = filters.source === s;
                const accent =
                  s === 'base'
                    ? COLORS.base
                    : s === 'added'
                      ? COLORS.added
                      : 'var(--primary)';
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onChange({ ...filters, source: s })}
                    className="flex-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                    style={{
                      background: isActive ? `${accent}33` : 'transparent',
                      color: isActive ? accent : 'var(--sidebar-muted-foreground)',
                      borderRight:
                        s !== 'added'
                          ? '1px solid var(--sidebar-border-soft)'
                          : 'none',
                    }}
                  >
                    {s === 'all' ? 'All' : s === 'base' ? 'Base' : 'Added'}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Ad type */}
          <section className="space-y-2.5">
            <p className={sectionLabelClass}>Ad type</p>
            <div className="flex rounded-lg border border-[var(--sidebar-border-soft)] bg-[var(--sidebar-input)]/60 overflow-hidden">
              {(['all', 'Daily', 'Lifetime'] as const).map((t) => {
                const isActive = filters.adType === t;
                const accent =
                  t === 'all' ? 'var(--primary)' : budgetTypeColor(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onChange({ ...filters, adType: t })}
                    className="flex-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                    style={{
                      background: isActive ? `${accent}33` : 'transparent',
                      color: isActive ? accent : 'var(--sidebar-muted-foreground)',
                      borderRight:
                        t !== 'Lifetime'
                          ? '1px solid var(--sidebar-border-soft)'
                          : 'none',
                    }}
                  >
                    {t === 'all' ? 'All' : t}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Account Rep */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className={sectionLabelClass}>Account Rep</p>
              {filters.accountRepUserId && (
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, accountRepUserId: null })}
                  className="text-[10px] font-medium text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <select
              value={filters.accountRepUserId ?? ''}
              onChange={(e) =>
                onChange({ ...filters, accountRepUserId: e.target.value || null })
              }
              className={sidebarInputClass}
            >
              <option value="">Any rep</option>
              {accountRepUsers.length === 0 ? (
                <option value="" disabled>
                  No reps assigned to ads in this period
                </option>
              ) : (
                accountRepUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))
              )}
            </select>
          </section>

          {/* Assignee */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className={sectionLabelClass}>Assignee</p>
              {filters.assigneeUserId && (
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, assigneeUserId: null })}
                  className="text-[10px] font-medium text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <select
              value={filters.assigneeUserId ?? ''}
              onChange={(e) =>
                onChange({ ...filters, assigneeUserId: e.target.value || null })
              }
              className={sidebarInputClass}
            >
              <option value="">Anyone assigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.department ? ` · ${u.department}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-[var(--sidebar-muted-foreground)] leading-relaxed">
              Matches ads where the user is the owner, designer, or account rep.
            </p>
          </section>
        </div>

        <div className="p-4 border-t border-[var(--sidebar-border-soft)] flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            disabled={active === 0}
            className="px-3 py-2 text-xs rounded-lg border border-[var(--sidebar-border-soft)] text-[var(--sidebar-muted-foreground)] hover:text-[var(--sidebar-foreground)] disabled:opacity-50 transition-colors"
          >
            Reset all
          </button>
          {inline ? (
            <span className="text-[10px] text-[var(--sidebar-muted-foreground)] tabular-nums">
              {active} active
            </span>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-xs rounded-lg border border-[var(--primary)] bg-[var(--primary)]/90 text-white hover:bg-[var(--primary)] transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </aside>
  );

  if (inline) return panel;

  return createPortal(
    <div className="fixed inset-0 z-[120]">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={onClose}
      />
      {panel}
    </div>,
    document.body,
  );
}
