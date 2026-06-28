'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  XMarkIcon,
  AdjustmentsHorizontalIcon,
  TableCellsIcon,
  ClipboardDocumentListIcon,
  ChartBarIcon,
  ChevronDownIcon,
  ChevronUpDownIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  CalendarIcon,
  InformationCircleIcon,
  LinkSlashIcon,
  UserCircleIcon,
  PaintBrushIcon,
  CheckBadgeIcon,
  TrashIcon,
  FunnelIcon,
  ArrowPathIcon,
  CheckIcon,
  CalculatorIcon,
  MagnifyingGlassIcon,
  ScaleIcon,
  LockClosedIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from '@/lib/toast';
import { AccountAvatar } from '@/components/account-avatar';
// Shared searchable people picker (search + avatars). Aliased — this file has
// its own department-filtered native-select `UserPicker` used by the planner
// form; the import modal wants the searchable one.
import { MetaBrandIcon } from '@/components/icons/platform-logos';
import { InvestmentIcon } from '@/components/icons/investment';
import { useAccount } from '@/contexts/account-context';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import BulkActionDock from '@/components/bulk-action-dock';
import { DatePicker } from '@/components/ui/date-picker';
import { DEFAULT_TIME_ZONE } from '@/lib/timezone';
import {
  CARRYOVER_THRESHOLD,
  COLORS,
  AD_COLORS,
  AD_STATUSES,
  DESIGN_STATUSES,
  APPROVAL_STATUSES,
  ACTIVE_STATUSES,
} from '@/lib/ad-pacer/constants';
import {
  buildAdCalc,
  buildPacerCalc,
  isLifetimeInProgress,
  effectiveActual,
} from '@/lib/ad-pacer/pacer-calc';
import type {
  DirectoryUser,
  ActivityEntry,
  PacerAd,
  PacerPlan,
  PriorOverUnder,
  PeriodSummary,
  SaveStatus,
} from '@/lib/ad-pacer/types';
import { effectiveSpendTarget } from '@/lib/ad-pacer/markup';
import {
  fmt,
  fmtDate,
  makeAd,
  fmtFullDate,
  fmtSyncedAgo,
  effMarkupOf,
  sourceLabel,
  sourceColor,
  sourceTint,
  budgetTypeColor,
  budgetTypeTint,
  adContribution,
  classifyPacerHealth,
} from '@/lib/ad-pacer/helpers';
import {
  currentPeriod,
  isValidPeriod,
  shiftPeriod,
  fmtPeriodLong,
  fmtPeriodShort,
} from '@/lib/ad-pacer/period';
import {
  type PlanFilters,
  EMPTY_FILTERS,
  isAdOverdue,
  applyFilters,
  activeFilterCount,
} from '@/lib/ad-pacer/filters';
import {
  PacerReadOnlyContext,
  usePacerReadOnly,
  Tooltip,
  inputClass,
  labelClass,
  SectionLabel,
  PeriodSelector,
  StatusBattery,
  AccountNotesButton,
  BudgetPanel,
  TotalAllocationHeader,
  EmptyPeriodState,
  AddPlanButton,
  useDragReorder,
  AdSummaryRow,
  PacerRow,
  AdEditorModal,
  BudgetCalculatorModal,
} from '@/app/app/tools/_shared';
import {
  ReconciliationPanel,
  ComparePanel,
  OverviewView,
  type OverviewAccount,
} from './ReconciliationViews';
import { AccountNotesDrawer, type AccountNote } from './AccountNotesDrawer';
import { BudgetLogDrawer, ChangeLogDrawer, type AdSnapshot } from './BudgetLogDrawer';
import { ImportFromMetaModal } from './ImportFromMetaModal';

// ─── Constants ─────────────────────────────────────────────────────────────
// Status/option lists + color maps now live in @/lib/ad-pacer/constants (imported above).

const num = (s: string | null | undefined): number | null => {
  if (s == null || s === '') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};
const newAdId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `tmp_${Math.random().toString(36).slice(2)}`;





// ─── Filter UI: status indicator + slide-from-right sidebar ────────────────
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
function FilterStatus({
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
function MetaAdsPacerFilterSidebar({
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


// `buildAdCalc` / `AdCalc` and `buildPacerCalc` / `PacerCalc` are the shared
// pacing math (imported from ../_lib/pacer-calc) — one source of truth so the
// Pacer and Summary views can never drift. They take the current instant
// (`Date.now()`) and the account's IANA `timeZone` (plan.timeZone).

// ─── Plan Ad Card (rich Monday-mapped editor) ──────────────────────────────
interface CopySourceAd {
  id: string;
  name: string;
  budgetType: string;
  budgetSource: 'base' | 'added' | 'split';
  flightStart: string | null;
  flightEnd: string | null;
}

// Which groups of fields a copy carries over (Change: copy options). Ad
// identity — name, budget type, budget source, recurring, co-op, action — is
// always copied; these are the optional extras.
interface CopyFieldOptions {
  assignments: boolean; // owner / designer / account rep
  statuses: boolean; // ad + design status
  approvals: boolean; // internal + client approval
  dates: boolean; // flight start/end, live, due, creative due
  budgets: boolean; // allocation, split base, daily budget
  creative: boolean; // creative link, client name, digital details
}
const DEFAULT_COPY_FIELDS: CopyFieldOptions = {
  assignments: true,
  statuses: true,
  approvals: true,
  dates: false,
  budgets: false,
  creative: true,
};
const COPY_FIELD_LABELS: { key: keyof CopyFieldOptions; label: string; hint: string }[] = [
  { key: 'assignments', label: 'Assignments', hint: 'Owner, designer, rep' },
  { key: 'statuses', label: 'Statuses', hint: 'Ad + design status' },
  { key: 'approvals', label: 'Approvals', hint: 'Internal + client' },
  { key: 'creative', label: 'Creative & notes', hint: 'Link, client, details' },
  { key: 'dates', label: 'Flight dates', hint: 'Start/end, live, due' },
  { key: 'budgets', label: 'Budget amounts', hint: 'Allocation, daily, split' },
];

function CopyPlanModal({
  accountKey,
  targetPeriod,
  periods,
  onClose,
  onCopy,
}: {
  accountKey: string;
  targetPeriod: string;
  periods: PeriodSummary[];
  onClose: () => void;
  onCopy: (
    from: string,
    adIds: string[],
    fields: CopyFieldOptions,
  ) => Promise<void>;
}) {
  const sources = useMemo(
    () => periods.filter((p) => p.period !== targetPeriod && p.adCount > 0),
    [periods, targetPeriod],
  );
  const [sourcePeriod, setSourcePeriod] = useState<string>(
    sources[0]?.period ?? '',
  );
  const [ads, setAds] = useState<CopySourceAd[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [fields, setFields] = useState<CopyFieldOptions>(DEFAULT_COPY_FIELDS);

  useEffect(() => {
    if (!sourcePeriod) {
      setAds([]);
      return;
    }
    let cancelled = false;
    setAds(null);
    setLoadError(null);
    setSelected(new Set());
    fetch(`/api/meta-ads-pacer/${accountKey}?period=${sourcePeriod}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ ads: CopySourceAd[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.ads) ? data.ads : [];
        setAds(list);
        // Pre-select all so the common "copy everything" path is one click
        setSelected(new Set(list.map((a) => a.id)));
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, sourcePeriod]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const allSelected = ads != null && ads.length > 0 && selected.size === ads.length;

  const toggleAll = () => {
    if (!ads) return;
    setSelected(allSelected ? new Set() : new Set(ads.map((a) => a.id)));
  };
  const toggleOne = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleCopy = async () => {
    if (selected.size === 0 || !sourcePeriod) return;
    setCopying(true);
    try {
      await onCopy(sourcePeriod, Array.from(selected), fields);
      onClose();
    } catch {
      // error surfaced via parent's save status
      setCopying(false);
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:pt-16 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-modal w-full max-w-lg rounded-xl p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-[var(--foreground)]">
              Copy ads to {fmtPeriodLong(targetPeriod)}
            </h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Ad name and budget type/source always copy. Choose what else to
              carry over below.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-3">
          <label className="block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
            Copy from
          </label>
          <select
            value={sourcePeriod}
            onChange={(e) => setSourcePeriod(e.target.value)}
            className={inputClass}
          >
            {sources.map((p) => (
              <option key={p.period} value={p.period}>
                {fmtPeriodLong(p.period)} — {p.adCount} ad
                {p.adCount !== 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
              Pick ads to copy
            </span>
            {ads && ads.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="text-[11px] text-[var(--primary)] hover:underline"
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
            {loadError ? (
              <div className="px-3 py-6 text-center text-xs text-red-400">
                {loadError}
              </div>
            ) : ads == null ? (
              <div className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
                Loading ads…
              </div>
            ) : ads.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
                That month has no ads.
              </div>
            ) : (
              ads.map((ad) => {
                const checked = selected.has(ad.id);
                return (
                  <label
                    key={ad.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--muted)]/40 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(ad.id)}
                      className="w-4 h-4 accent-[var(--primary)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[var(--foreground)] truncate">
                        {ad.name || 'Untitled Ad'}
                      </div>
                      <div className="text-[10px] text-[var(--muted-foreground)] flex items-center gap-2">
                        <span>{ad.budgetType}</span>
                        <span>·</span>
                        <span>
                          {sourceLabel(ad.budgetSource)}
                        </span>
                        {ad.flightStart && ad.flightEnd && (
                          <>
                            <span>·</span>
                            <span>
                              {fmtDate(ad.flightStart)} – {fmtDate(ad.flightEnd)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* What to carry over — defaults match the old behavior (identity +
            statuses/approvals/assignments/creative on; dates + budgets off). */}
        <div className="mb-4">
          <span className="block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">
            Carry over
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {COPY_FIELD_LABELS.map(({ key, label, hint }) => (
              <label
                key={key}
                className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--muted)]/40 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={fields[key]}
                  onChange={(e) =>
                    setFields((f) => ({ ...f, [key]: e.target.checked }))
                  }
                  className="w-4 h-4 mt-0.5 accent-[var(--primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-[var(--foreground)]">
                    {label}
                  </span>
                  <span className="block text-[10px] text-[var(--muted-foreground)]">
                    {hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={selected.size === 0 || copying}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--primary)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--primary)]/90 transition-colors"
          >
            {copying
              ? 'Copying…'
              : `Copy ${selected.size} ad${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}


// ─── Ad Planner panel ──────────────────────────────────────────────────────
type EditorState =
  | { mode: 'create'; draft: PacerAd }
  | { mode: 'edit'; adId: string; original: PacerAd };

function AdPlannerPanel({
  plan,
  period,
  users,
  filters,
  onFiltersChange,
  currentUserId,
  periodSummaries,
  onChange,
  onCopyFrom,
  onImport,
  onModalOpenChange,
  onAddActivity,
  onEditActivity,
  onDeleteActivity,
}: {
  plan: PacerPlan;
  period: string;
  users: DirectoryUser[];
  filters: PlanFilters;
  onFiltersChange: (next: PlanFilters) => void;
  currentUserId: string | null;
  periodSummaries: PeriodSummary[];
  onChange: (p: PacerPlan) => void;
  onImport?: () => void;
  onCopyFrom: (
    from: string,
    adIds: string[] | undefined,
    fields: CopyFieldOptions,
  ) => Promise<void> | void;
  onModalOpenChange?: (open: boolean) => void;
  onAddActivity: (adId: string, text: string, file: File | null) => Promise<void>;
  onEditActivity: (adId: string, entryId: string, text: string) => Promise<void>;
  onDeleteActivity: (adId: string, entryId: string) => Promise<void>;
}) {
  const readOnly = usePacerReadOnly();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showCalcModal, setShowCalcModal] = useState(false);

  const handleReorder = (nextAds: PacerAd[]) => {
    if (readOnly) return; // frozen month — reorder is a no-op
    onChange({ ...plan, ads: nextAds });
  };
  const drag = useDragReorder(plan.ads, handleReorder);

  // Notify parent so it can pause autosave while a modal owns the in-flight edits.
  useEffect(() => {
    onModalOpenChange?.(editor !== null);
  }, [editor, onModalOpenChange]);

  // Always-current ref to the plan so the soft-delete undo callback can
  // splice into the latest state even if the user kept editing after the
  // delete fired.
  const planRef = useRef(plan);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  const removeAd = (id: string) => {
    if (readOnly) return; // frozen month — deletion is disabled
    const idx = plan.ads.findIndex((a) => a.id === id);
    if (idx === -1) return;
    const removed = plan.ads[idx];
    onChange({ ...plan, ads: plan.ads.filter((a) => a.id !== id) });
    if (editor?.mode === 'edit' && editor.adId === id) setEditor(null);

    // Soft-delete UX: surface an undo affordance via a sonner toast that
    // reinserts the ad at its original index. The autosave debounce fires
    // again on undo to re-persist the row.
    toast.success(`Removed "${removed.name || 'Untitled Ad'}"`, {
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: () => {
          const current = planRef.current;
          // Bail if the row somehow already exists (shouldn't, but guard
          // against double-undo race).
          if (current.ads.some((a) => a.id === removed.id)) return;
          const next = [...current.ads];
          const insertAt = Math.min(idx, next.length);
          next.splice(insertAt, 0, removed);
          onChange({ ...current, ads: next });
        },
      },
    });
  };
  const openCreate = () => {
    const fresh = makeAd(plan.ads.length, period);
    setEditor({ mode: 'create', draft: fresh });
  };
  const openEdit = (id: string) => {
    const original = plan.ads.find((a) => a.id === id);
    if (!original) return;
    setEditor({ mode: 'edit', adId: id, original });
  };
  const cloneAd = (id: string) => {
    const src = plan.ads.find((a) => a.id === id);
    if (!src) return;
    const cloneName = `${src.name || 'Ad'} (copy)`;
    const cloned: PacerAd = {
      ...src,
      id: newAdId(),
      position: plan.ads.length,
      name: cloneName,
      // Dates reset — a fresh copy shouldn't inherit the source's schedule
      flightStart: null,
      flightEnd: null,
      liveDate: null,
      creativeDueDate: null,
      dueDate: null,
      dateCompleted: null,
      // Budget + pacer fields reset — start blank so we don't apply stale spend
      allocation: null,
      pacerActual: null,
      pacerDailyBudget: null,
      pacerTodayDate: null,
      pacerEndDate: null,
      // Facebook link reset — a copy must not inherit the source's campaign
      // mapping, or both rows would sync the same spend onto themselves.
      metaObjectType: null,
      metaObjectId: null,
      metaEffectiveStatus: null,
      pacerSyncedAt: null,
      // Activity log + design notes are tied to the original — start fresh
      activityLog: [],
      designNotes: [],
    };
    onChange({ ...plan, ads: [...plan.ads, cloned] });
  };

  const handleSave = (draft: PacerAd) => {
    if (!editor) return;
    if (editor.mode === 'create') {
      onChange({ ...plan, ads: [...plan.ads, draft] });
    } else {
      // Preserve the LIVE activity log from plan — the modal's draft still
      // holds the snapshot from when it opened, but updates posted while
      // editing live in plan and shouldn't be overwritten on Save.
      onChange({
        ...plan,
        ads: plan.ads.map((a) =>
          a.id === editor.adId
            ? {
                ...draft,
                activityLog: a.activityLog,
                designNotes: a.designNotes,
              }
            : a,
        ),
      });
    }
    setEditor(null);
  };

  const [search, setSearch] = useState('');
  const visibleAds = useMemo(() => {
    const filtered = applyFilters(plan.ads, filters, currentUserId);
    const q = search.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((a) => (a.name || '').toLowerCase().includes(q));
  }, [plan.ads, filters, currentUserId, search]);

  // ── Bulk selection ──────────────────────────────────────────────────────
  const { confirm } = useLoomiDialog();
  const [selectedAdIds, setSelectedAdIds] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<BulkField | null>(null);

  // Drop selections that fall out of view (e.g., a filter hides them) so
  // bulk actions never silently affect rows the user can't see.
  useEffect(() => {
    setSelectedAdIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(visibleAds.map((a) => a.id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [visibleAds]);

  const allVisibleSelected =
    visibleAds.length > 0 && visibleAds.every((a) => selectedAdIds.has(a.id));
  const someVisibleSelected = visibleAds.some((a) => selectedAdIds.has(a.id));

  const toggleSelectAd = (id: string) => {
    setSelectedAdIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAllVisible = () => {
    setSelectedAdIds((prev) => {
      if (visibleAds.every((a) => prev.has(a.id))) {
        const next = new Set(prev);
        visibleAds.forEach((a) => next.delete(a.id));
        return next;
      }
      const next = new Set(prev);
      visibleAds.forEach((a) => next.add(a.id));
      return next;
    });
  };
  const clearSelection = () => setSelectedAdIds(new Set());

  const handleBulkDelete = async () => {
    const n = selectedAdIds.size;
    if (n === 0) return;
    const ok = await confirm({
      title: `Delete ${n} ad${n !== 1 ? 's' : ''}?`,
      message: 'You can undo each removal individually from the toast notifications.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    // Calling removeAd(id) in a forEach loop creates N separate onChange
    // calls, each reading `plan.ads` from the stale closure — React batches
    // them and the last call wins, leaving N-1 ads still alive. Snapshot
    // the removed rows once, then do a single batched state update.
    const idSet = selectedAdIds;
    const removedItems: Array<{ ad: PacerAd; idx: number }> = [];
    plan.ads.forEach((ad, idx) => {
      if (idSet.has(ad.id)) removedItems.push({ ad, idx });
    });
    if (removedItems.length === 0) {
      clearSelection();
      return;
    }

    onChange({
      ...plan,
      ads: plan.ads.filter((a) => !idSet.has(a.id)),
    });
    if (editor?.mode === 'edit' && idSet.has(editor.adId)) setEditor(null);

    // Per-row undo toasts, same UX as single-row delete — undo uses
    // planRef.current so each one splices into the latest state.
    for (const { ad: removed, idx } of removedItems) {
      toast.success(`Removed "${removed.name || 'Untitled Ad'}"`, {
        duration: 6000,
        action: {
          label: 'Undo',
          onClick: () => {
            const current = planRef.current;
            if (current.ads.some((a) => a.id === removed.id)) return;
            const next = [...current.ads];
            const insertAt = Math.min(idx, next.length);
            next.splice(insertAt, 0, removed);
            onChange({ ...current, ads: next });
          },
        },
      });
    }

    clearSelection();
  };

  const applyBulkPatch = (patch: Partial<PacerAd>) => {
    const n = selectedAdIds.size;
    if (n === 0) return;
    onChange({
      ...plan,
      ads: plan.ads.map((a) => (selectedAdIds.has(a.id) ? { ...a, ...patch } : a)),
    });
    toast.success(`Updated ${n} ad${n !== 1 ? 's' : ''}`);
    setBulkField(null);
    clearSelection();
  };

  const editorInitialAd: PacerAd | null =
    editor?.mode === 'create' ? editor.draft : editor?.original ?? null;

  // Re-pull the activity log from plan on every render so newly posted /
  // edited / deleted updates appear in the modal without a refresh.
  const editorLiveActivityLog: ActivityEntry[] | undefined =
    editor?.mode === 'edit'
      ? plan.ads.find((a) => a.id === editor.adId)?.activityLog
      : undefined;

  const otherPeriodsWithAds = useMemo(
    () =>
      periodSummaries.filter((p) => p.period !== period && p.adCount > 0).length >
      0,
    [periodSummaries, period],
  );

  return (
    <div>
      {/* Header row: Ad Plan label + Add Plan CTA on the right */}
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <h2 className="m-0 flex items-center gap-2 text-base font-bold tracking-tight text-[var(--foreground)]">
          <ClipboardDocumentListIcon className="w-4 h-4" />
          {`Ad Plan · ${fmtPeriodLong(period)} (${visibleAds.length}${
            visibleAds.length !== plan.ads.length ? ` of ${plan.ads.length}` : ''
          } ad${plan.ads.length !== 1 ? 's' : ''})`}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick search by ad name — applied on top of the active filters. */}
          <div className="relative">
            <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ads…"
              aria-label="Search ads by name"
              className="pl-8 pr-7 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)] w-44"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
              >
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Tooltip
            label={
              readOnly
                ? 'This month is frozen'
                : 'Spread a budget evenly or with locked amounts/percentages'
            }
          >
          <button
            type="button"
            onClick={() => setShowCalcModal(true)}
            disabled={plan.ads.length === 0 || readOnly}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <CalculatorIcon className="w-3.5 h-3.5" />
            Calculator
          </button>
          </Tooltip>
          {!readOnly && (
            <AddPlanButton
              onCreateNew={openCreate}
              onOpenCopy={() => setShowCopyModal(true)}
              onImport={onImport}
              importIcon={<MetaBrandIcon className="w-4 h-4" />}
              importLabel="Import from Meta"
              hasOtherPeriods={otherPeriodsWithAds}
            />
          )}
        </div>
      </div>

      {plan.ads.length > 0 && (
        <FilterStatus
          filters={filters}
          onClear={() => onFiltersChange(EMPTY_FILTERS)}
          filteredCount={visibleAds.length}
          totalCount={plan.ads.length}
        />
      )}

      {plan.ads.length === 0 ? (
        <EmptyPeriodState
          period={period}
          periodSummaries={periodSummaries}
          onAddAd={openCreate}
          onOpenCopy={() => setShowCopyModal(true)}
        />
      ) : visibleAds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] py-10 px-6 text-center text-sm text-[var(--muted-foreground)] mb-3">
          No ads match the current filters.
        </div>
      ) : (
        <div className="glass-table">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                  <th className="w-9 pl-3 pr-1 py-2">
                    <input
                      type="checkbox"
                      aria-label={
                        allVisibleSelected ? 'Deselect all ads' : 'Select all ads'
                      }
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                      }}
                      onChange={toggleSelectAllVisible}
                      className="h-4 w-4 rounded border-[var(--border)] bg-[var(--input)] text-[var(--primary)] cursor-pointer accent-[var(--primary)]"
                    />
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Ad
                  </th>
                  {/* Updates icon column — no header, just kept aligned */}
                  <th className="w-10 px-2 py-2"></th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Due Date
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Budget
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Allocation
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Flight Dates
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Design
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                    Approvals
                  </th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visibleAds.map((ad) => (
                  <AdSummaryRow
                    key={ad.id}
                    ad={ad}
                    index={plan.ads.findIndex((a) => a.id === ad.id)}
                    onClick={() => openEdit(ad.id)}
                    onRemove={removeAd}
                    onClone={cloneAd}
                    dragProps={drag.rowProps(ad.id)}
                    isDragging={drag.draggedId === ad.id}
                    isDropTarget={
                      drag.dropTargetId === ad.id && drag.draggedId !== ad.id
                    }
                    dropEdge={
                      drag.dropTargetId === ad.id ? drag.dropEdge : null
                    }
                    isSelected={selectedAdIds.has(ad.id)}
                    onSelectToggle={() => toggleSelectAd(ad.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editor && editorInitialAd && (
        <AdEditorModal
          initialAd={editorInitialAd}
          markup={plan.markup}
          liveActivityLog={editorLiveActivityLog}
          mode={editor.mode}
          users={users}
          currentUserId={currentUserId}
          onSave={handleSave}
          onCancel={() => setEditor(null)}
          onAddActivity={onAddActivity}
          onEditActivity={onEditActivity}
          onDeleteActivity={onDeleteActivity}
        />
      )}

      {showCopyModal && (
        <CopyPlanModal
          accountKey={plan.accountKey}
          targetPeriod={period}
          periods={periodSummaries}
          onClose={() => setShowCopyModal(false)}
          onCopy={(from, adIds, fields) =>
            Promise.resolve(onCopyFrom(from, adIds, fields))
          }
        />
      )}

      {showCalcModal && (
        <BudgetCalculatorModal
          plan={plan}
          onClose={() => setShowCalcModal(false)}
          onApply={(updates) => {
            onChange({
              ...plan,
              ads: plan.ads.map((a) => {
                const u = updates[a.id];
                if (u == null) return a;
                return {
                  ...a,
                  allocation: u.allocation.toFixed(2),
                  ...(u.splitBaseAmount != null
                    ? { splitBaseAmount: u.splitBaseAmount.toFixed(2) }
                    : {}),
                };
              }),
            });
            setShowCalcModal(false);
          }}
        />
      )}

      {bulkField && (
        <BulkEditModal
          field={bulkField}
          count={selectedAdIds.size}
          users={users}
          onClose={() => setBulkField(null)}
          onApply={applyBulkPatch}
        />
      )}

      {selectedAdIds.size > 0 && (
        <BulkActionDock
          count={selectedAdIds.size}
          itemLabel={selectedAdIds.size === 1 ? 'ad' : 'ads'}
          onClose={clearSelection}
          actions={[
            {
              id: 'select-all',
              label: allVisibleSelected ? 'Deselect all' : 'Select all',
              icon: <CheckIcon className="h-4 w-4" />,
              onClick: toggleSelectAllVisible,
              disabled: visibleAds.length === 0,
            },
            {
              id: 'flight',
              label: 'Flight Dates',
              icon: <CalendarIcon className="h-4 w-4" />,
              onClick: () => setBulkField('flight'),
            },
            {
              id: 'budget-type',
              label: 'Budget Type',
              icon: <ChartBarIcon className="h-4 w-4" />,
              onClick: () => setBulkField('budgetType'),
            },
            {
              id: 'budget-source',
              label: 'Budget Source',
              icon: <FunnelIcon className="h-4 w-4" />,
              onClick: () => setBulkField('budgetSource'),
            },
            {
              id: 'owner',
              label: 'Owner',
              icon: <UserCircleIcon className="h-4 w-4" />,
              onClick: () => setBulkField('owner'),
            },
            {
              id: 'ad-status',
              label: 'Ad Status',
              icon: <ClockIcon className="h-4 w-4" />,
              onClick: () => setBulkField('adStatus'),
            },
            {
              id: 'design-status',
              label: 'Design Status',
              icon: <PaintBrushIcon className="h-4 w-4" />,
              onClick: () => setBulkField('designStatus'),
            },
            {
              id: 'internal-status',
              label: 'Internal Status',
              icon: <CheckBadgeIcon className="h-4 w-4" />,
              onClick: () => setBulkField('internalApproval'),
            },
            {
              id: 'client-status',
              label: 'Client Status',
              icon: <CheckBadgeIcon className="h-4 w-4" />,
              onClick: () => setBulkField('clientApproval'),
            },
            {
              id: 'delete',
              label: 'Delete',
              icon: <TrashIcon className="h-4 w-4" />,
              onClick: handleBulkDelete,
              danger: true,
            },
          ]}
        />
      )}
    </div>
  );
}

// ─── Bulk-edit modal ───────────────────────────────────────────────────────
type BulkField =
  | 'flight'
  | 'budgetType'
  | 'budgetSource'
  | 'owner'
  | 'adStatus'
  | 'designStatus'
  | 'internalApproval'
  | 'clientApproval';

const BULK_FIELD_LABELS: Record<BulkField, string> = {
  flight: 'Flight Dates',
  budgetType: 'Budget Type',
  budgetSource: 'Budget Source',
  owner: 'Owner',
  adStatus: 'Ad Status',
  designStatus: 'Design Status',
  internalApproval: 'Internal Status',
  clientApproval: 'Client Status',
};



// ─── Budget Log ───────────────────────────────────────────────────────────
// Point-in-time snapshots of the per-ad pacer numbers (mirrors the
// Summary tab columns). Reps log entries while reviewing the monthly
// pacer to track when budgets were checked or adjusted.


// Small chat-bubble button that opens the account-level notes modal.
// The count badge surfaces when there's at least one note so reps can
// see at a glance which accounts have unread context.

function BulkEditModal({
  field,
  count,
  users,
  onClose,
  onApply,
}: {
  field: BulkField;
  count: number;
  users: DirectoryUser[];
  onClose: () => void;
  onApply: (patch: Partial<PacerAd>) => void;
}) {
  const [flightStart, setFlightStart] = useState<string | null>(null);
  const [flightEnd, setFlightEnd] = useState<string | null>(null);
  const [budgetType, setBudgetType] = useState<'Daily' | 'Lifetime'>('Daily');
  const [budgetSource, setBudgetSource] = useState<'base' | 'added'>('base');
  const [ownerId, setOwnerId] = useState<string>('');
  const [adStatus, setAdStatus] = useState<string>(AD_STATUSES[0]);
  const [designStatus, setDesignStatus] = useState<string>(DESIGN_STATUSES[0]);
  const [internalApproval, setInternalApproval] = useState<string>(
    APPROVAL_STATUSES[0],
  );
  const [clientApproval, setClientApproval] = useState<string>(
    APPROVAL_STATUSES[0],
  );

  const noun = `${count} ad${count !== 1 ? 's' : ''}`;

  const handleSubmit = () => {
    switch (field) {
      case 'flight':
        if (!flightStart || !flightEnd) return;
        onApply({ flightStart, flightEnd });
        return;
      case 'budgetType':
        onApply({ budgetType });
        return;
      case 'budgetSource':
        onApply({ budgetSource });
        return;
      case 'owner':
        // Empty string clears the owner — treat that as a valid choice.
        onApply({ ownerUserId: ownerId === '' ? null : ownerId });
        return;
      case 'adStatus':
        onApply({ adStatus });
        return;
      case 'designStatus':
        onApply({ designStatus });
        return;
      case 'internalApproval':
        onApply({ internalApproval });
        return;
      case 'clientApproval':
        onApply({ clientApproval });
        return;
    }
  };

  const submitDisabled = field === 'flight' && (!flightStart || !flightEnd);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 sm:pt-24 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-modal w-full max-w-md rounded-xl p-5"
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-[var(--foreground)]">
              Set {BULK_FIELD_LABELS[field]}
            </h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Applies to {noun}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          {field === 'flight' && (
            <>
              <label className={labelClass}>Flight Range (Start – End)</label>
              <DatePicker
                mode="range"
                value={{ start: flightStart, end: flightEnd }}
                onChange={(r) => {
                  setFlightStart(r.start);
                  setFlightEnd(r.end);
                }}
                placeholder="Click & drag to select flight window"
              />
            </>
          )}
          {field === 'budgetType' && (
            <>
              <label className={labelClass}>Budget Type</label>
              <select
                value={budgetType}
                onChange={(e) => setBudgetType(e.target.value as 'Daily' | 'Lifetime')}
                className={inputClass}
              >
                <option value="Daily">Daily</option>
                <option value="Lifetime">Lifetime</option>
              </select>
            </>
          )}
          {field === 'budgetSource' && (
            <>
              <label className={labelClass}>Budget Source</label>
              <select
                value={budgetSource}
                onChange={(e) => setBudgetSource(e.target.value as 'base' | 'added')}
                className={inputClass}
              >
                <option value="base">Base</option>
                <option value="added">Added</option>
              </select>
            </>
          )}
          {field === 'owner' && (
            <>
              <label className={labelClass}>Owner</label>
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className={inputClass}
              >
                <option value="">— Unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {field === 'adStatus' && (
            <>
              <label className={labelClass}>Ad Status</label>
              <select
                value={adStatus}
                onChange={(e) => setAdStatus(e.target.value)}
                className={inputClass}
              >
                {AD_STATUSES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </>
          )}
          {field === 'designStatus' && (
            <>
              <label className={labelClass}>Design Status</label>
              <select
                value={designStatus}
                onChange={(e) => setDesignStatus(e.target.value)}
                className={inputClass}
              >
                {DESIGN_STATUSES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </>
          )}
          {field === 'internalApproval' && (
            <>
              <label className={labelClass}>Internal Status</label>
              <select
                value={internalApproval}
                onChange={(e) => setInternalApproval(e.target.value)}
                className={inputClass}
              >
                {APPROVAL_STATUSES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </>
          )}
          {field === 'clientApproval' && (
            <>
              <label className={labelClass}>Client Status</label>
              <select
                value={clientApproval}
                onChange={(e) => setClientApproval(e.target.value)}
                className={inputClass}
              >
                {APPROVAL_STATUSES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="px-3 py-1.5 text-sm rounded-lg bg-[var(--primary)] text-white font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply to {noun}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Pacer row ─────────────────────────────────────────────────────────────

interface MetaAdSetOption {
  id: string;
  name: string;
  effectiveStatus: string | null;
  /** Parent campaign, shown as context so similar ad-set names are distinct. */
  campaignName: string | null;
}

/**
 * Searchable ad-set link picker — a custom combobox replacing the native
 * <select>. Accounts can have dozens of ad sets with long, similar names, so a
 * type-to-filter box (matching campaign + ad set + status) is far faster than
 * scrolling a plain dropdown. Lazy-loads the list on first open, closes on
 * outside-click / Escape.
 */
function AdSetLinkPicker({
  value,
  options,
  loading,
  error,
  onOpen,
  onChange,
  disabled,
}: {
  value: string | null;
  options: MetaAdSetOption[] | null;
  loading: boolean;
  error: string | null;
  onOpen: () => void;
  onChange: (id: string | null) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
  } | null>(null);

  // Portal the panel to <body> with fixed coords so it escapes the card's
  // overflow-hidden + backdrop-filter and any scroll container that would
  // otherwise clip an absolutely-positioned dropdown. Flips above the trigger
  // when there isn't room below.
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const estHeight = 340;
    const spaceBelow = window.innerHeight - rect.bottom;
    // Flip above only when there isn't room below AND there's more room above.
    // When flipping, anchor by the panel's *bottom* edge to the trigger's top
    // rather than computing a top from a height estimate — a short list (a few
    // ad sets) is far shorter than `estHeight`, so a top-anchored flip would
    // leave it floating hundreds of px above the trigger. Bottom-anchoring
    // keeps it glued to the trigger no matter how tall the list actually is.
    if (spaceBelow < estHeight && rect.top > spaceBelow) {
      setPos({
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
        width: rect.width,
      });
    } else {
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => updatePosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = (o: MetaAdSetOption) =>
    `${o.campaignName ? `${o.campaignName} › ` : ''}${o.name}`;
  const selected = (options ?? []).find((o) => o.id === value) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = (options ?? []).filter((o) =>
    `${o.campaignName ?? ''} ${o.name} ${o.effectiveStatus ?? ''}`
      .toLowerCase()
      .includes(q),
  );

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <>
      {value ? (
        // Linked: show the ad-set NAME (never the raw id) + a quick Unlink.
        // Clicking the name reopens the list to change the link.
        <div className="flex items-center gap-1.5 min-w-0">
          <Tooltip label="Linked to a Meta ad set — click to change" className="min-w-0">
          <button
            ref={triggerRef}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              if (!open) {
                onOpen();
                setQuery('');
              }
              setOpen((v) => !v);
            }}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] px-2.5 py-1 text-xs text-[var(--foreground)] hover:border-[var(--primary)] focus:outline-none focus:border-[var(--primary)] disabled:opacity-60"
          >
            <MetaBrandIcon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate font-medium">
              {loading && !options ? 'Loading…' : selected ? label(selected) : 'Linked'}
            </span>
            <ChevronDownIcon className="w-3 h-3 flex-shrink-0 text-[var(--muted-foreground)]" />
          </button>
          </Tooltip>
          <Tooltip label="Unlink ad set" className="flex-shrink-0">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            aria-label="Unlink ad set"
            className="inline-flex items-center justify-center rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[#ef4444] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <LinkSlashIcon className="w-4 h-4" />
          </button>
          </Tooltip>
        </div>
      ) : (
        <Tooltip label="Link this line to a Meta ad set to pull its spend on Sync">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            if (!open) {
              onOpen();
              setQuery('');
            }
            setOpen((v) => !v);
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#1877F2] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#1877F2]/90 focus:outline-none focus:ring-2 focus:ring-[#1877F2]/40 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <MetaBrandIcon className="w-3 h-3 flex-shrink-0 brightness-0 invert" />
          Link ad set
          <ChevronDownIcon className="w-3 h-3 flex-shrink-0 text-white/80" />
        </button>
        </Tooltip>
      )}

      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              className="glass-dropdown fixed z-[200]"
              style={{
                top: pos.top,
                bottom: pos.bottom,
                left: pos.left,
                width: Math.max(pos.width, 260),
              }}
            >
              <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-2 py-1.5">
                <MagnifyingGlassIcon className="w-3.5 h-3.5 flex-shrink-0 text-[var(--muted-foreground)]" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search ad sets…"
                  className="w-full bg-transparent text-[11px] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none"
                />
              </div>
              <div className="max-h-64 overflow-y-auto themed-scrollbar py-1">
                {loading ? (
                  <div className="px-2.5 py-2 text-[11px] text-[var(--muted-foreground)]">
                    Loading ad sets…
                  </div>
                ) : error ? (
                  <div className="px-2.5 py-2 text-[11px] text-[#ef4444]">
                    {error}
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => pick(null)}
                      className={`flex w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-[var(--muted)] ${
                        value
                          ? 'text-[var(--muted-foreground)]'
                          : 'font-medium text-[var(--foreground)]'
                      }`}
                    >
                      Not linked — match by name
                    </button>
                    {filtered.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => pick(o.id)}
                        className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-[11px] hover:bg-[var(--muted)] ${
                          o.id === value ? 'bg-[var(--muted)]/60 font-medium' : ''
                        }`}
                      >
                        <span className="min-w-0 flex-1 text-[var(--foreground)]">
                          {o.campaignName && (
                            <span className="text-[var(--muted-foreground)]">
                              {o.campaignName} ›{' '}
                            </span>
                          )}
                          {o.name}
                        </span>
                        {o.effectiveStatus && (
                          <span className="flex-shrink-0 text-[9px] uppercase tracking-wide text-[var(--muted-foreground)] mt-0.5">
                            {o.effectiveStatus}
                          </span>
                        )}
                      </button>
                    ))}
                    {filtered.length === 0 && (
                      <div className="px-2.5 py-2 text-[11px] text-[var(--muted-foreground)]">
                        No ad sets match “{query}”.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// Meta-specific slots injected into the shared <PacerRow>. Kept here (not in
// _shared) because they read Meta-only fields (metaStartDate/End,
// metaEffectiveStatus) — the Google tool passes its own equivalents.

/** Run-window tooltip beside the link control; null when there's no Meta run. */
function MetaSyncInfo({ ad, timeZone }: { ad: PacerAd; timeZone: string }) {
  if (!ad.metaObjectId || (!ad.metaStartDate && !ad.metaEndDate)) return null;
  const effectiveEnd = buildPacerCalc(ad, Date.now(), timeZone).effectiveEnd;
  const parts: string[] = [
    `Meta run: ${ad.metaStartDate ? fmtDate(ad.metaStartDate) : '—'} → ${ad.metaEndDate ? fmtDate(ad.metaEndDate) : 'ongoing'}`,
  ];
  if (effectiveEnd && (!ad.metaEndDate || ad.metaEndDate > effectiveEnd)) {
    parts.push(`Paced to ${fmtDate(effectiveEnd)} (month end)`);
  }
  return (
    <Tooltip label={parts.join(' · ')} placement="top">
      <span className="inline-flex flex-shrink-0 items-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
        <InformationCircleIcon className="w-4 h-4" />
      </span>
    </Tooltip>
  );
}

/**
 * Meta status mismatch (Change 11): Meta reports the ad not delivering while the
 * planner still says Live mid-flight; don't auto-flip (Meta "paused" can be a
 * daily cap / billing hold) — surface a one-click confirm. null when in sync.
 */
function MetaStatusMismatch({
  ad,
  onMarkOff,
}: {
  ad: PacerAd;
  onMarkOff: () => void;
}) {
  const readOnly = usePacerReadOnly();
  const meta = ad.metaEffectiveStatus;
  const plannerLive =
    ad.adStatus === 'Live' || ad.adStatus === 'Live - Changes Required';
  if (!meta || !plannerLive || meta.toUpperCase() === 'ACTIVE') return null;
  const through = ad.metaEndDate ?? ad.flightEnd;
  return (
    <div
      className="mb-3.5 rounded-md border px-2.5 py-2 text-[10px]"
      style={{ borderColor: `${COLORS.warn}66`, background: 'rgba(245,158,11,0.08)' }}
    >
      <div className="text-[var(--foreground)] leading-snug">
        Meta shows <span className="font-semibold">{meta}</span>
        {through ? <> — but scheduled through {fmtDate(through)}</> : null}.
      </div>
      <button
        type="button"
        onClick={onMarkOff}
        disabled={readOnly}
        className="mt-1 inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--card)] px-2 py-0.5 font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Mark Off in planner
      </button>
    </div>
  );
}

// ─── Budget Pacer panel ────────────────────────────────────────────────────
interface AccountPacing {
  // 'final' = a settled (frozen/closed) month's final variance (colored
  // over/under verdict). 'progress' = a LIVE month's plain spend-of-target
  // readout — deliberately NOT a pace verdict, so a mid-month "60% spent" can't
  // false-alarm as "under"; the per-ad pacing badges carry the on-pace judgment.
  mode: 'progress' | 'final';
  pct: number; // spent ÷ target × 100
  status: 'on-track' | 'over' | 'under' | 'neutral'; // 'progress' is always neutral
  spent: number; // account actual spend
  target: number; // effective spend target (client budget × markup + carryover)
  dayElapsed: number; // live only: day-of-month so the % reads in context
  dayTotal: number;
}

function PacerSpendTotals({
  base,
  added,
  actual,
  pacing,
}: {
  base: number;
  added: number;
  actual: number;
  // Account-wide pacing vs TIME-ADJUSTED expected spend (Change 9), aggregated
  // per-ad (finished ads contribute full target, mid-flight ads prorated).
  pacing?: AccountPacing | null;
}) {
  const isFinal = pacing?.mode === 'final';
  const isProgress = pacing?.mode === 'progress';
  // 'final' = a colored over/under verdict; 'progress' = a neutral readout.
  const pacingColor =
    pacing == null
      ? undefined
      : isProgress
        ? 'var(--muted-foreground)'
        : pacing.status === 'on-track'
          ? COLORS.success
          : pacing.status === 'over'
            ? COLORS.error
            : COLORS.warn;
  const pacingHeader = isFinal ? 'Final variance' : 'Spend progress';
  const pacingTitle = isFinal
    ? "Settled month: total actual spend vs the account's effective target (client budget × markup + carryover) — the final over/under, matching the Over/Under page."
    : "Account spend so far vs the month's effective target (client budget × markup + carryover), with day-of-month context. A plain progress readout — NOT a pace verdict; read the per-ad pacing badges for on-track health.";
  // Big headline value (matches Total Spend / Actual) + a small gray sub-line.
  const pacingMain =
    pacing == null
      ? ''
      : isFinal
        ? pacing.status === 'on-track'
          ? 'On target'
          : `${pacing.pct - 100 > 0 ? '+' : ''}${(pacing.pct - 100).toFixed(1)}% ${
              pacing.status === 'over' ? 'over' : 'under'
            }`
        : `${pacing.pct.toFixed(0)}% of target`;
  const pacingSub =
    pacing == null
      ? ''
      : isFinal
        ? 'final variance'
        : `day ${pacing.dayElapsed}/${pacing.dayTotal}`;
  const barPct = pacing ? Math.min(Math.max(pacing.pct, 0), 100) : 0;
  // Neutral brand color for a live progress readout; status color for a
  // settled month's verdict.
  const barColor = isProgress ? COLORS.lifetime : pacingColor;
  return (
    <div className="flex flex-wrap items-start justify-end gap-6">
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
          Total Spend
        </div>
        <div className="text-lg font-bold text-[var(--foreground)]">
          {fmt(base + added)}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
          Actual (Pacer)
        </div>
        <div className="text-lg font-bold" style={{ color: COLORS.lifetime }}>
          {fmt(actual)}
        </div>
      </div>
      {pacing && pacingColor && (
        <Tooltip label={pacingTitle}>
        <div className="min-w-[160px]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
            {pacingHeader}
          </div>
          <div
            className="text-lg font-bold whitespace-nowrap"
            style={{ color: isProgress ? 'var(--foreground)' : pacingColor }}
          >
            {pacingMain}
          </div>
          <div className="text-[10px] text-[var(--muted-foreground)]">
            {pacingSub}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${barPct}%`, background: barColor }}
            />
          </div>
        </div>
        </Tooltip>
      )}
    </div>
  );
}

function BudgetPacerPanel({
  plan,
  filters,
  onFiltersChange,
  currentUserId,
  onChange,
  accountKey,
  headerActions,
}: {
  plan: PacerPlan;
  filters: PlanFilters;
  onFiltersChange: (next: PlanFilters) => void;
  currentUserId: string | null;
  onChange: (p: PacerPlan) => void;
  accountKey: string;
  headerActions?: React.ReactNode;
}) {
  // Frozen-month lock — passed to the shared PacerRow's injected link picker.
  const readOnly = usePacerReadOnly();
  // Per-ad expand state. Auto-seeded on first render (and on plan
  // changes) so rows that need attention are open by default; rep can
  // still toggle each manually.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const seededExpandedRef = useRef(false);
  // Cross-month reassurance note is dismissible (X) — once closed it stays
  // hidden for this view.
  const [crossMonthNoteDismissed, setCrossMonthNoteDismissed] = useState(false);

  const updateAd = (u: PacerAd) =>
    onChange({ ...plan, ads: plan.ads.map((a) => (a.id === u.id ? u : a)) });

  // Lazy-loaded Meta ad-set list for the per-row link picker. Fetched once on
  // first picker focus, then shared across every row.
  const [metaAdSets, setMetaAdSets] = useState<MetaAdSetOption[] | null>(null);
  const [adSetsLoading, setAdSetsLoading] = useState(false);
  const [adSetsError, setAdSetsError] = useState<string | null>(null);
  const loadMetaAdSets = useCallback(async () => {
    if (metaAdSets || adSetsLoading) return;
    setAdSetsLoading(true);
    setAdSetsError(null);
    try {
      const res = await fetch(`/api/meta-ads-pacer/${accountKey}/meta-adsets`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setAdSetsError(data?.error || 'Failed to load ad sets.');
        return;
      }
      setMetaAdSets(Array.isArray(data?.adSets) ? data.adSets : []);
    } catch {
      setAdSetsError('Failed to load ad sets.');
    } finally {
      setAdSetsLoading(false);
    }
  }, [accountKey, metaAdSets, adSetsLoading]);

  // Write a row's edited daily budget back to its linked Meta ad set. Returns a
  // result the row renders inline (the agency token needs `ads_management`, so
  // a read-only token surfaces Meta's permission error here).
  const pushDailyBudget = useCallback(
    async (adId: string, value: string): Promise<{ ok: boolean; text: string }> => {
      try {
        const res = await fetch(
          `/api/meta-ads-pacer/${accountKey}/push-budget?period=${plan.period}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adId, dailyBudget: value }),
          },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) return { ok: false, text: data?.error || 'Push failed.' };
        return { ok: true, text: 'Pushed to Meta ✓' };
      } catch {
        return { ok: false, text: 'Push failed — network error.' };
      }
    },
    [accountKey, plan.period],
  );

  // §2: resolve a cross-month straddler (count its full run in its own month),
  // set a lifetime planned split, or clear. Optimistically updates the ad's
  // persisted resolution fields, then writes through the dedicated endpoint
  // (server-authoritative, so a re-sync or autosave can't clobber it).
  const resolveCrossMonth = useCallback(
    async (
      adId: string,
      action: 'apply_full_run' | 'split' | 'clear',
      splitMap?: Record<string, number>,
    ) => {
      // The CTA is disabled when frozen and the endpoint rejects a frozen
      // month (409), so no client-side readOnly guard is needed here.
      const prior = plan.ads.find((a) => a.id === adId);
      onChange({
        ...plan,
        ads: plan.ads.map((a) =>
          a.id === adId
            ? {
                ...a,
                fullRunAppliedToMonth:
                  action === 'apply_full_run' ? plan.period : null,
                lifetimeMonthSplit:
                  action === 'split' ? JSON.stringify(splitMap ?? {}) : null,
              }
            : a,
        ),
      });
      try {
        const res = await fetch(
          `/api/meta-ads-pacer/${accountKey}/resolve-cross-month?period=${plan.period}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              adId,
              action,
              ...(action === 'split' ? { splitMap } : {}),
            }),
          },
        );
        if (!res.ok) {
          const d = await res.json().catch(() => null);
          toast.error(d?.error || 'Failed to update cross-month resolution.');
          if (prior) {
            onChange({
              ...plan,
              ads: plan.ads.map((a) => (a.id === adId ? prior : a)),
            });
          }
        }
      } catch {
        toast.error('Failed to update cross-month resolution — network error.');
        if (prior) {
          onChange({
            ...plan,
            ads: plan.ads.map((a) => (a.id === adId ? prior : a)),
          });
        }
      }
    },
    [accountKey, plan, onChange],
  );

  const visibleAds = useMemo(
    () => applyFilters(plan.ads, filters, currentUserId),
    [plan.ads, filters, currentUserId],
  );
  const allExpanded =
    visibleAds.length > 0 && visibleAds.every((a) => expandedIds.has(a.id));


  // Auto-expand needs-attention rows ONCE per mount so the rep lands on
  // the things that need work. Re-running on plan change would fight
  // the user's manual collapses; we instead seed once and let the user
  // own the state from there.
  useEffect(() => {
    if (seededExpandedRef.current) return;
    if (plan.ads.length === 0) return;
    seededExpandedRef.current = true;
    const next = new Set<string>();
    const nowMs = Date.now();
    plan.ads.forEach((ad) => {
      const c = buildPacerCalc(ad, nowMs, plan.timeZone);
      const h = classifyPacerHealth(ad, c);
      if (h.state === 'over-budget' || h.state === 'overpacing') {
        next.add(ad.id);
      }
    });
    if (next.size > 0) setExpandedIds(next);
  }, [plan.ads, plan.timeZone]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (plan.ads.length === 0) {
    return (
      <div>
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <h2 className="m-0 flex items-center gap-2 text-base font-bold tracking-tight text-[var(--foreground)]">
            <ChartBarIcon className="w-4 h-4" />
            Spend Pacing
          </h2>
          {headerActions}
        </div>
        <div className="glass-section-card rounded-xl px-6 py-12 text-center">
          <ClipboardDocumentListIcon className="w-10 h-10 mx-auto mb-3 text-[var(--muted-foreground)]" />
          <div className="text-sm text-[var(--foreground)] font-medium mb-1">
            No ads in your plan yet.
          </div>
          <div className="text-xs text-[var(--muted-foreground)]">
            Add ads in the Ad Planner tab and they'll appear here automatically.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <h2 className="m-0 flex items-center gap-2 text-base font-bold tracking-tight text-[var(--foreground)]">
          <ChartBarIcon className="w-4 h-4" />
          {`Spend Pacing (${visibleAds.length}${
            visibleAds.length !== plan.ads.length ? ` of ${plan.ads.length}` : ''
          } ad${plan.ads.length !== 1 ? 's' : ''})`}
        </h2>
        {/* All actions live on one row, grouped: table/bulk controls first,
            then a divider, then the account/Meta actions. */}
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <Tooltip label={allExpanded ? 'Collapse all rows' : 'Expand all rows'}>
          <button
            type="button"
            onClick={() =>
              setExpandedIds(
                allExpanded ? new Set() : new Set(visibleAds.map((a) => a.id)),
              )
            }
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <ChevronUpDownIcon className="w-3.5 h-3.5" />
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
          </Tooltip>
          {headerActions && (
            <>
              <div className="mx-1 h-5 w-px bg-[var(--border)]" />
              {headerActions}
            </>
          )}
        </div>
      </div>
      {(() => {
        // Reassurance that an odd-looking total is explained — driven by the
        // user's MANUAL cross-month marks (no auto-detection): a billed
        // cross-month ad counts its full run in the over/under though only its
        // in-month slice lands in the month total.
        const crossMonthCount = visibleAds.filter(
          (a) => a.fullRunAppliedToMonth != null,
        ).length;
        if (crossMonthCount === 0 || crossMonthNoteDismissed) return null;
        return (
          <div
            className="mb-3 flex items-start justify-between gap-3 rounded-md border px-2.5 py-1.5 text-[11px]"
            style={{
              borderColor: 'rgba(249,115,22,0.3)',
              background: 'rgba(249,115,22,0.08)',
              color: '#f97316',
            }}
          >
            <span>
              {crossMonthCount} ad{crossMonthCount === 1 ? '' : 's'} billed
              cross-month — the full run is counted in the over/under though part
              spent in another month, so the monthly total can differ (expand a
              flagged row for details).
            </span>
            <Tooltip label="Dismiss" className="flex-shrink-0">
            <button
              type="button"
              onClick={() => setCrossMonthNoteDismissed(true)}
              aria-label="Dismiss"
              className="-mr-0.5 rounded p-0.5 hover:bg-[var(--muted)] transition-colors"
            >
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
            </Tooltip>
          </div>
        );
      })()}
      <FilterStatus
        filters={filters}
        onClear={() => onFiltersChange(EMPTY_FILTERS)}
        filteredCount={visibleAds.length}
        totalCount={plan.ads.length}
      />
      {visibleAds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] py-10 px-6 text-center text-sm text-[var(--muted-foreground)]">
          No ads match the current filters.
        </div>
      ) : (
        visibleAds.map((ad) => (
          <PacerRow
            key={`${ad.id}-${ad.budgetType}`}
            ad={ad}
            index={plan.ads.findIndex((a) => a.id === ad.id)}
            timeZone={plan.timeZone}
            onActualChange={(v) => updateAd({ ...ad, pacerActual: v })}
            onDailyBudgetChange={(v) => updateAd({ ...ad, pacerDailyBudget: v })}
            expanded={expandedIds.has(ad.id)}
            onToggleExpanded={() => toggleExpanded(ad.id)}
            onMuteToggle={() =>
              updateAd({ ...ad, alertsMuted: !ad.alertsMuted })
            }
            onPushDailyBudget={(value) => pushDailyBudget(ad.id, value)}
            onResolveCrossMonth={(action, splitMap) =>
              resolveCrossMonth(ad.id, action, splitMap)
            }
            siblings={plan.siblingsByName?.[ad.name] ?? null}
            synced={!!ad.metaObjectId && !!ad.pacerSyncedAt}
            linkError={adSetsError}
            pushLabel="Push to Meta"
            pushIcon={<MetaBrandIcon className="w-3.5 h-3.5" />}
            linkPicker={
              <AdSetLinkPicker
                value={ad.metaObjectId}
                options={metaAdSets}
                loading={adSetsLoading}
                error={adSetsError}
                onOpen={loadMetaAdSets}
                onChange={(adSetId) =>
                  updateAd({
                    ...ad,
                    metaObjectId: adSetId,
                    metaObjectType: adSetId ? 'adset' : null,
                  })
                }
                disabled={readOnly}
              />
            }
            syncInfo={<MetaSyncInfo ad={ad} timeZone={plan.timeZone} />}
            statusMismatch={
              <MetaStatusMismatch
                ad={ad}
                onMarkOff={() => updateAd({ ...ad, adStatus: 'Off' })}
              />
            }
          />
        ))
      )}
    </div>
  );
}

// ─── Summary panel (top-level Summary tab) ─────────────────────────────────
function SummaryPanel({ plan }: { plan: PacerPlan }) {
  const calcs = useMemo(
    () => plan.ads.map((ad) => buildAdCalc(ad, Date.now(), plan.timeZone)),
    [plan],
  );
  const totalProjected = calcs.reduce((s, c) => s + c.projected, 0);
  const totalActual = calcs.reduce((s, c) => s + (c.actual ?? 0), 0);
  const totalTarget = calcs.reduce((s, c) => s + (c.target ?? 0), 0);
  const baseGoal = num(plan.baseBudgetGoal);
  const addedGoal = num(plan.addedBudgetGoal);
  const combinedGoal =
    baseGoal != null || addedGoal != null ? (baseGoal ?? 0) + (addedGoal ?? 0) : null;

  if (plan.ads.length === 0) {
    return (
      <div className="glass-section-card rounded-xl px-6 py-12 text-center">
        <p className="text-sm text-[var(--foreground)] font-medium mb-1">No ads yet</p>
        <p className="text-xs text-[var(--muted-foreground)]">
          Add at least one ad in the Budgeting tab to see a summary.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-section-card rounded-xl px-5 py-4">
      <SectionLabel icon={<TableCellsIcon className="w-3 h-3" />} text="Summary Table" />
      {(baseGoal != null || addedGoal != null) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Base Budget
            </div>
            <div className="text-lg font-bold tabular-nums" style={{ color: COLORS.base }}>
              {baseGoal != null ? fmt(baseGoal) : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Added Budget
            </div>
            <div className="text-lg font-bold tabular-nums" style={{ color: COLORS.added }}>
              {addedGoal != null ? fmt(addedGoal) : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Combined Total
            </div>
            <div className="text-lg font-bold tabular-nums text-[var(--foreground)]">
              {combinedGoal != null ? fmt(combinedGoal) : '—'}
            </div>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {[
                'Ad Name',
                'Type',
                'Source',
                'Date Range',
                'Days',
                'Budget',
                'Projected',
                'Actual',
                'Target',
                'Rec. Daily',
                'Δ Budget',
              ].map((h) => (
                <th
                  key={h}
                  className="px-2.5 py-2 text-left text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calcs.map((c, i) => (
              <tr key={c.ad.id} className="border-b border-[var(--border)]">
                <td className="px-2.5 py-2.5 text-[var(--foreground)] max-w-[160px] truncate">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-sm mr-1.5 align-middle"
                    style={{ background: AD_COLORS[i % AD_COLORS.length] }}
                  />
                  {c.ad.name}
                </td>
                <td className="px-2.5 py-2.5">
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{
                      background: budgetTypeTint(c.ad.budgetType),
                      color: budgetTypeColor(c.ad.budgetType),
                    }}
                  >
                    {c.ad.budgetType}
                  </span>
                </td>
                <td className="px-2.5 py-2.5">
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{
                      background: sourceTint(c.ad.budgetSource),
                      color: sourceColor(c.ad.budgetSource),
                    }}
                  >
                    {sourceLabel(c.ad.budgetSource)}
                  </span>
                </td>
                <td className="px-2.5 py-2.5 text-[var(--muted-foreground)] whitespace-nowrap">
                  {c.ad.flightStart && c.ad.flightEnd
                    ? `${fmtFullDate(c.ad.flightStart)} → ${fmtFullDate(c.ad.flightEnd)}`
                    : '—'}
                </td>
                <td className="px-2.5 py-2.5 text-[var(--muted-foreground)]">
                  {c.days > 0 ? c.days : '—'}
                </td>
                <td
                  className="px-2.5 py-2.5"
                  style={{ color: budgetTypeColor(c.ad.budgetType) }}
                >
                  {fmt(c.totalBudget)}
                  <span className="ml-1 text-[9px] text-[var(--muted-foreground)]">
                    {c.isLifetime ? 'total' : '/day'}
                  </span>
                </td>
                <td className="px-2.5 py-2.5 text-[var(--foreground)]">
                  {fmt(c.projected)}
                </td>
                <td
                  className="px-2.5 py-2.5"
                  style={{
                    color: c.actual != null ? COLORS.lifetime : 'var(--muted-foreground)',
                    opacity: c.actual != null ? 1 : 0.6,
                  }}
                >
                  {c.actual != null ? fmt(c.actual) : '—'}
                </td>
                <td
                  className="px-2.5 py-2.5"
                  style={{
                    color: c.target != null ? 'var(--foreground)' : 'var(--muted-foreground)',
                    opacity: c.target != null ? 1 : 0.6,
                  }}
                >
                  {c.target != null ? fmt(c.target) : '—'}
                </td>
                <td
                  className="px-2.5 py-2.5"
                  style={{
                    color:
                      c.recDaily != null ? COLORS.success : 'var(--muted-foreground)',
                    opacity: c.recDaily != null ? 1 : 0.6,
                  }}
                >
                  {c.isLifetime ? (
                    <span className="text-[var(--muted-foreground)]">n/a</span>
                  ) : c.recDaily != null ? (
                    fmt(c.recDaily)
                  ) : (
                    '—'
                  )}
                </td>
                <td
                  className="px-2.5 py-2.5 font-bold"
                  style={{
                    color:
                      c.delta == null
                        ? 'var(--muted-foreground)'
                        : c.delta > 0
                          ? COLORS.success
                          : c.delta < 0
                            ? COLORS.error
                            : 'var(--foreground)',
                    opacity: c.delta == null ? 0.6 : 1,
                  }}
                >
                  {c.delta != null ? `${c.delta >= 0 ? '+' : ''}${fmt(c.delta)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--border)]">
              <td
                colSpan={5}
                className="px-2.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]"
              >
                Totals
              </td>
              <td className="px-2.5 py-2.5 text-[9px] text-[var(--muted-foreground)]">
                —
              </td>
              <td
                className="px-2.5 py-2.5 font-bold"
                style={{ color: COLORS.daily }}
              >
                {fmt(totalProjected)}
              </td>
              <td
                className="px-2.5 py-2.5 font-bold"
                style={{ color: COLORS.lifetime }}
              >
                {totalActual > 0 ? fmt(totalActual) : '—'}
              </td>
              <td className="px-2.5 py-2.5 font-bold text-[var(--foreground)]">
                {totalTarget > 0 ? fmt(totalTarget) : '—'}
              </td>
              <td colSpan={2} />
            </tr>
            {combinedGoal != null && (
              <tr className="border-t border-[var(--border)] bg-[var(--muted)]">
                <td
                  colSpan={5}
                  className="px-2.5 py-2.5 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]"
                >
                  Combined Budget Goal
                </td>
                <td colSpan={6} className="px-2.5 py-2.5">
                  <span className="text-[var(--foreground)] font-bold">
                    {fmt(Math.round(combinedGoal * effMarkupOf(plan.markup) * 100) / 100)}
                  </span>
                  <span className="text-[var(--muted-foreground)]"> actual / </span>
                  <span style={{ color: COLORS.daily }} className="font-bold">
                    {fmt(combinedGoal)}
                  </span>
                  <span className="text-[var(--muted-foreground)]"> gross client</span>
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}


// ─── Import from Meta (onboarding) ──────────────────────────────────────────

// ─── Main tool component ───────────────────────────────────────────────────
/**
 * Shared shell rendered by both the Ad Planner and Ad Pacer pages. The
 * `mode` prop controls which surface is shown. In `pacer` mode the page
 * header gets a Pacer | Summary toggle that swaps the body content.
 */
type MetaToolMode = 'planner' | 'pacer';
type PacerInnerTab = 'pacer' | 'summary' | 'compare';
// Planner page sub-tabs: the planner itself + the Reconciliation view
// (moved here from the Pacer page).
type PlannerInnerTab = 'planner' | 'reconcile';

export function MetaAdsPlannerTool({ mode: initialMode }: { mode: MetaToolMode }) {
  const { accountKey, accounts, setAccount } = useAccount();
  const { data: session } = useSession();
  const { markDirty, markClean } = useUnsavedChanges();
  const { confirm } = useLoomiDialog();
  const currentUserId = session?.user?.id ?? null;

  const activeKey = accountKey;
  const activeAccount = activeKey ? accounts[activeKey] : null;

  // ── URL state: period (and pacerTab on the Ad Pacer page) sync to/from
  //    query params so reload and bookmarks survive. Filters and view-mode
  //    stay in local state.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlPeriod = searchParams.get('period');
  const urlPacerTab = searchParams.get('pacerTab');
  const urlPlannerTab = searchParams.get('plannerTab');
  const urlView = searchParams.get('view');

  // Planner + Pacer are one consolidated page now; `mode` is switchable state
  // (seeded from ?view= or the route default) and mirrors back to the URL via
  // the sync effect below, so the Plan/Pace toggle is bookmarkable.
  const [mode, setMode] = useState<MetaToolMode>(
    urlView === 'pacer' ? 'pacer' : urlView === 'planner' ? 'planner' : initialMode,
  );

  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [period, setPeriod] = useState<string>(
    urlPeriod && isValidPeriod(urlPeriod) ? urlPeriod : currentPeriod(),
  );
  const [periodSummaries, setPeriodSummaries] = useState<PeriodSummary[]>([]);
  const [plan, setPlan] = useState<PacerPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Autosave still tracks status via setSaveStatus; the visible indicator was
  // removed from the header, so the value itself is no longer read.
  const [, setSaveStatus] = useState<SaveStatus>('idle');
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [applyingCarryover, setApplyingCarryover] = useState(false);
  const [carryoverBucket, setCarryoverBucket] = useState<'base' | 'added'>('base');
  const [carryoverDismissed, setCarryoverDismissed] = useState(false);
  // Budget Log + Change Log now live in the account scope row (pacer), so
  // their open-state + drawers are lifted here and work on every pacer sub-tab.
  const [budgetLogOpen, setBudgetLogOpen] = useState(false);
  const [changeLogOpen, setChangeLogOpen] = useState(false);
  // "Import from Meta" onboarding modal (available in planner + pacer).
  const [importOpen, setImportOpen] = useState(false);
  const adsSnapshot = useMemo<AdSnapshot[]>(
    () =>
      plan
        ? plan.ads.map((ad) => {
            const c = buildAdCalc(ad, Date.now(), plan.timeZone);
            return {
              adId: ad.id,
              adName: ad.name || 'Untitled Ad',
              budgetType: ad.budgetType,
              budgetSource: ad.budgetSource,
              budget: c.totalBudget,
              projected: c.projected,
              actual: c.actual,
              target: c.target,
              recDaily: c.recDaily,
            };
          })
        : [],
    [plan],
  );
  const [pacerTab, setPacerTab] = useState<PacerInnerTab>(
    urlPacerTab === 'summary'
      ? 'summary'
      : urlPacerTab === 'compare'
        ? 'compare'
        : 'pacer',
  );
  const [plannerTab, setPlannerTab] = useState<PlannerInnerTab>(
    urlPlannerTab === 'reconcile' ? 'reconcile' : 'planner',
  );

  // Mirror state changes back into the URL (replace, not push, so the
  // back button stays useful for actual navigation).
  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('period', period);
    next.set('view', mode);
    if (mode === 'pacer') next.set('pacerTab', pacerTab);
    else next.delete('pacerTab');
    if (mode === 'planner') next.set('plannerTab', plannerTab);
    else next.delete('plannerTab');
    const qs = next.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    router.replace(url, { scroll: false });
    // Intentionally exclude `searchParams` so external param changes don't
    // re-trigger this loop (we read from it once on mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, pacerTab, plannerTab, mode, pathname, router]);
  const [filters, setFilters] = useState<PlanFilters>(EMPTY_FILTERS);
  const [filterSidebarOpen, setFilterSidebarOpen] = useState(false);
  // Lifted overview list — fetched once per period when there's no
  // active account so the parent can also wire the filter sidebar's
  // `ads` prop on the admin overview. OverviewView consumes this via
  // props instead of owning the fetch.
  const [overviewAccounts, setOverviewAccounts] = useState<OverviewAccount[] | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  useEffect(() => {
    if (activeKey) return; // only relevant for the admin overview
    let cancelled = false;
    setOverviewAccounts(null);
    setOverviewError(null);
    fetch(`/api/meta-ads-pacer/overview?period=${period}`)
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status} ${text.slice(0, 200)}`);
        }
        return r.json() as Promise<{ accounts: OverviewAccount[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setOverviewAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('[meta-ads-pacer] overview load failed', err);
        setOverviewError(err instanceof Error ? err.message : 'Failed to load overview');
      });
    return () => {
      cancelled = true;
    };
  }, [period, activeKey]);
  // Flatten every overview account's ads so the filter sidebar can
  // surface accurate Quick View counts + account-rep options on the
  // admin overview (when there's no per-account `plan` to draw from).
  const overviewAds = useMemo(
    () => (overviewAccounts ?? []).flatMap((a) => a.ads),
    [overviewAccounts],
  );
  // True while the AdEditorModal is open. Pauses autosave so transient draft
  // edits don't get persisted until the user clicks Save.
  const [editorOpen, setEditorOpen] = useState(false);
  // Account-level notes modal — opened from the chat icon next to the
  // period selector. Count fetched on activeKey change so the badge can
  // surface "this account has notes" without opening the panel.
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesCount, setNotesCount] = useState<number | null>(null);
  useEffect(() => {
    if (!accountKey) {
      setNotesCount(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/meta-ads-pacer/${accountKey}/notes?period=${period}`)
      .then((r) => (r.ok ? r.json() : { notes: [] }))
      .then((data: { notes?: AccountNote[] }) => {
        if (cancelled) return;
        setNotesCount(Array.isArray(data.notes) ? data.notes.length : 0);
      })
      .catch(() => {
        if (cancelled) return;
        setNotesCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, period]);

  // ── Fetch directory of users (once) ──
  useEffect(() => {
    fetch('/api/users')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setUsers(data);
      })
      .catch(() => {
        // tolerate failure — pickers will just show empty list
      });
  }, []);

  // ── Load plan whenever active account or period changes ──
  useEffect(() => {
    if (!activeKey) {
      setPlan(null);
      setLoadError(null);
      setLoaded(true);
      setPeriodSummaries([]);
      setFilters(EMPTY_FILTERS);
      return;
    }
    setLoaded(false);
    setLoadError(null);
    setFilters(EMPTY_FILTERS);
    setCarryoverDismissed(false);
    setCarryoverBucket('base');

    Promise.all([
      fetch(`/api/meta-ads-pacer/${activeKey}?period=${period}`).then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status} ${text.slice(0, 200)}`);
        }
        return r.json() as Promise<PacerPlan>;
      }),
      fetch(`/api/meta-ads-pacer/${activeKey}/periods`)
        .then((r) => (r.ok ? r.json() : { periods: [] }))
        .catch(() => ({ periods: [] })) as Promise<{ periods: PeriodSummary[] }>,
    ])
      .then(([planData, periodsData]) => {
        setPlan({
          accountKey: planData.accountKey ?? activeKey,
          period: planData.period ?? period,
          baseBudgetGoal: planData.baseBudgetGoal ?? null,
          addedBudgetGoal: planData.addedBudgetGoal ?? null,
          markup:
            typeof planData.markup === 'number' &&
            Number.isFinite(planData.markup)
              ? planData.markup
              : null,
          timeZone:
            typeof planData.timeZone === 'string' && planData.timeZone
              ? planData.timeZone
              : DEFAULT_TIME_ZONE,
          frozen: planData.frozen === true,
          frozenAt: planData.frozenAt ?? null,
          reopened: planData.reopened === true,
          baseCarryover: planData.baseCarryover ?? null,
          addedCarryover: planData.addedCarryover ?? null,
          priorOverUnder: planData.priorOverUnder ?? null,
          ads: Array.isArray(planData.ads) ? planData.ads : [],
          siblingsByName: planData.siblingsByName,
        });
        setPeriodSummaries(
          Array.isArray(periodsData?.periods) ? periodsData.periods : [],
        );
        setLoaded(true);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[meta-ads-pacer] failed to load plan', err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load plan');
        setLoaded(true);
      });
  }, [activeKey, period]);

  // ── Debounced save (PUT) ──
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');
  // Reset save dedupe when account/period changes so the first edit triggers a save
  useEffect(() => {
    lastSavedRef.current = '';
  }, [activeKey, period]);

  useEffect(() => {
    if (!loaded || !activeKey || !plan) return;
    // A frozen (closed) month is read-only — never autosave it. The server
    // also rejects the write, but suppressing here avoids failed-save churn.
    if (plan.frozen) return;
    // Pause autosave while the editor modal is open so partial drafts aren't
    // persisted; the modal commits via its own Save handler instead.
    if (editorOpen) return;
    const serialized = JSON.stringify({
      baseBudgetGoal: plan.baseBudgetGoal,
      addedBudgetGoal: plan.addedBudgetGoal,
      ads: plan.ads.map((a, i) => ({ ...a, position: i, period })),
    });
    if (serialized === lastSavedRef.current) return;

    // Local plan diverged from the last-saved baseline — flag the global
    // unsaved-changes guard so navigating away mid-edit prompts the user.
    markDirty();
    setSaveStatus('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      // Retries the PUT once with backoff before surfacing an error so
      // a transient blip (network hiccup, cold lambda) doesn't strand the
      // user with a red dot. Both attempts use the same serialized body —
      // saves are idempotent at this granularity.
      const attemptSave = async (attempt = 0): Promise<boolean> => {
        try {
          const res = await fetch(
            `/api/meta-ads-pacer/${activeKey}?period=${period}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: serialized,
            },
          );
          if (!res.ok) throw new Error('save failed');
          // Don't replace local state with the server response — the user may
          // have typed more during the 600ms debounce + network round-trip,
          // and overwriting would clobber those keystrokes.
          await res.json().catch(() => null);
          return true;
        } catch {
          if (attempt < 1) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            return attemptSave(attempt + 1);
          }
          return false;
        }
      };
      const ok = await attemptSave();
      if (ok) {
        lastSavedRef.current = serialized;
        setSaveStatus('saved');
        markClean();
        setTimeout(() => setSaveStatus('idle'), 1500);
      } else {
        setSaveStatus('error');
      }
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [plan, activeKey, loaded, period, markClean, markDirty, editorOpen]);

  // ── Sync actual spend from Facebook ──
  // Pulls per-campaign spend for the current period and drops the refreshed
  // plan straight into state. Linked rows (or rows whose name matches a
  // campaign) get their pacerActual overwritten by Facebook's number; the
  // existing autosave effect persists the result.
  const handleSyncMeta = async (opts?: { auto?: boolean }) => {
    if (!activeKey || syncingMeta) return;
    // Auto = the silent background refresh on load (stale-while-revalidate):
    // no toasts, and the route skips the audit entry. The button spinner is
    // the only surfaced signal.
    const auto = opts?.auto === true;
    setSyncingMeta(true);
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${activeKey}/sync-meta?period=${period}${auto ? '&auto=1' : ''}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (!auto) toast.error(data?.error || 'Meta sync failed.');
        return;
      }
      setPlan({
        accountKey: data.accountKey ?? activeKey,
        period: data.period ?? period,
        baseBudgetGoal: data.baseBudgetGoal ?? null,
        addedBudgetGoal: data.addedBudgetGoal ?? null,
        markup:
          typeof data.markup === 'number' && Number.isFinite(data.markup)
            ? data.markup
            : null,
        timeZone:
          typeof data.timeZone === 'string' && data.timeZone
            ? data.timeZone
            : DEFAULT_TIME_ZONE,
        frozen: data.frozen === true,
        frozenAt: data.frozenAt ?? null,
        reopened: data.reopened === true,
        baseCarryover: data.baseCarryover ?? null,
        addedCarryover: data.addedCarryover ?? null,
        priorOverUnder: data.priorOverUnder ?? null,
        ads: Array.isArray(data.ads) ? data.ads : [],
        siblingsByName: data.siblingsByName,
      });
      // Background refresh: the rows just updated silently — no toasts.
      if (auto) return;
      const sync = data.sync as
        | { matched: number; total: number; results: { matched: boolean; name: string }[] }
        | undefined;
      if (!sync || sync.total === 0) {
        toast.success('Synced — no ads to match for this period yet.');
      } else if (sync.matched === 0) {
        toast.error(
          'No ads matched a Meta campaign. Name a pacer ad exactly like its campaign, then sync again.',
        );
      } else {
        const unmatched = sync.results
          .filter((r) => !r.matched)
          .map((r) => r.name || 'Untitled');
        toast.success(
          `Synced spend for ${sync.matched} of ${sync.total} ad${
            sync.total === 1 ? '' : 's'
          } from Meta.${
            unmatched.length ? ` Unmatched: ${unmatched.join(', ')}.` : ''
          }`,
        );
      }
    } catch {
      if (!auto) toast.error('Meta sync failed.');
    } finally {
      setSyncingMeta(false);
    }
  };

  // ── Auto-refresh from Meta on load (stale-while-revalidate) ──
  // The pacer renders from cached DB rows immediately; once loaded, if the
  // linked ads' spend is stale we fire ONE silent background sync. Latest sync
  // fn + plan live in refs so the effect fires once per account/period load
  // without re-running on every plan edit or chasing the fn's identity.
  const autoSyncFnRef = useRef<(opts?: { auto?: boolean }) => void>(() => {});
  autoSyncFnRef.current = handleSyncMeta;
  const planRef = useRef<PacerPlan | null>(null);
  planRef.current = plan;
  // Per account+period cooldown so a sync that keeps failing can't re-fire on
  // every render — it retries at most once per stale window.
  const autoSyncAttemptRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (mode !== 'pacer' || !activeKey || !loaded) return;
    const p = planRef.current;
    if (!p || p.frozen) return;
    // Only ad sets actually linked to Meta can be refreshed.
    const linked = p.ads.filter((a) => a.metaObjectId);
    if (linked.length === 0) return;
    const STALE_MS = 15 * 60 * 1000;
    const now = Date.now();
    const anyNeverSynced = linked.some((a) => !a.pacerSyncedAt);
    const freshest = linked.reduce((max, a) => {
      const t = a.pacerSyncedAt ? Date.parse(a.pacerSyncedAt) : NaN;
      return Number.isFinite(t) && t > max ? t : max;
    }, 0);
    if (!anyNeverSynced && now - freshest <= STALE_MS) return; // still fresh
    const key = `${activeKey}:${period}`;
    const last = autoSyncAttemptRef.current.get(key) ?? 0;
    if (now - last < STALE_MS) return; // attempted recently — don't loop
    autoSyncAttemptRef.current.set(key, now);
    autoSyncFnRef.current({ auto: true });
  }, [activeKey, period, loaded, mode]);

  // ── Apply the refreshed plan returned by the "Import from Meta" modal ──
  // The import route returns the same period view as a sync, so the rows drop
  // straight into state (the modal owns its own toast + close).
  const handleImported = (raw: unknown) => {
    const data = (raw ?? {}) as Record<string, unknown>;
    setPlan({
      accountKey: (data.accountKey as string) ?? activeKey ?? '',
      period: (data.period as string) ?? period,
      baseBudgetGoal: (data.baseBudgetGoal as string | null) ?? null,
      addedBudgetGoal: (data.addedBudgetGoal as string | null) ?? null,
      markup:
        typeof data.markup === 'number' && Number.isFinite(data.markup)
          ? (data.markup as number)
          : null,
      timeZone:
        typeof data.timeZone === 'string' && data.timeZone
          ? (data.timeZone as string)
          : DEFAULT_TIME_ZONE,
      frozen: data.frozen === true,
      frozenAt: (data.frozenAt as string | null) ?? null,
      reopened: data.reopened === true,
      baseCarryover: (data.baseCarryover as string | null) ?? null,
      addedCarryover: (data.addedCarryover as string | null) ?? null,
      priorOverUnder: (data.priorOverUnder as PriorOverUnder | null) ?? null,
      ads: Array.isArray(data.ads) ? (data.ads as PacerAd[]) : [],
      siblingsByName: data.siblingsByName as PacerPlan['siblingsByName'],
    });
  };

  // ── Reopen a frozen (closed) month for correction (admin escape hatch) ──
  const handleReopenMonth = async () => {
    if (!activeKey || reopening) return;
    setReopening(true);
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${activeKey}/reopen?period=${period}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not reopen this month.');
        return;
      }
      setPlan({
        accountKey: data.accountKey ?? activeKey,
        period: data.period ?? period,
        baseBudgetGoal: data.baseBudgetGoal ?? null,
        addedBudgetGoal: data.addedBudgetGoal ?? null,
        markup:
          typeof data.markup === 'number' && Number.isFinite(data.markup)
            ? data.markup
            : null,
        timeZone:
          typeof data.timeZone === 'string' && data.timeZone
            ? data.timeZone
            : DEFAULT_TIME_ZONE,
        frozen: data.frozen === true,
        frozenAt: data.frozenAt ?? null,
        reopened: data.reopened === true,
        baseCarryover: data.baseCarryover ?? null,
        addedCarryover: data.addedCarryover ?? null,
        priorOverUnder: data.priorOverUnder ?? null,
        ads: Array.isArray(data.ads) ? data.ads : [],
        siblingsByName: data.siblingsByName,
      });
      // Re-enable autosave from the reopened baseline.
      lastSavedRef.current = '';
      toast.success(
        `${fmtPeriodLong(period)} reopened for editing. The original snapshot is kept; it re-freezes on the next close.`,
      );
    } catch {
      toast.error('Could not reopen this month.');
    } finally {
      setReopening(false);
    }
  };

  // ── Re-freeze a reopened month once corrections are done ──
  const handleRefreezeMonth = async () => {
    if (!activeKey || reopening) return;
    setReopening(true);
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${activeKey}/freeze?period=${period}`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not re-freeze this month.');
        return;
      }
      setPlan({
        accountKey: data.accountKey ?? activeKey,
        period: data.period ?? period,
        baseBudgetGoal: data.baseBudgetGoal ?? null,
        addedBudgetGoal: data.addedBudgetGoal ?? null,
        markup:
          typeof data.markup === 'number' && Number.isFinite(data.markup)
            ? data.markup
            : null,
        timeZone:
          typeof data.timeZone === 'string' && data.timeZone
            ? data.timeZone
            : DEFAULT_TIME_ZONE,
        frozen: data.frozen === true,
        frozenAt: data.frozenAt ?? null,
        reopened: data.reopened === true,
        baseCarryover: data.baseCarryover ?? null,
        addedCarryover: data.addedCarryover ?? null,
        priorOverUnder: data.priorOverUnder ?? null,
        ads: Array.isArray(data.ads) ? data.ads : [],
        siblingsByName: data.siblingsByName,
      });
      toast.success(`${fmtPeriodLong(period)} re-frozen.`);
    } catch {
      toast.error('Could not re-freeze this month.');
    } finally {
      setReopening(false);
    }
  };

  // ── Apply / clear last month's carryover into this month (Change 7) ──
  const handleApplyCarryover = async (
    bucket: 'base' | 'added',
    clear: boolean,
  ) => {
    if (!activeKey || applyingCarryover) return;
    setApplyingCarryover(true);
    try {
      const res = await fetch(
        `/api/meta-ads-pacer/${activeKey}/carryover?period=${period}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket, clear }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not update carryover.');
        return;
      }
      setPlan({
        accountKey: data.accountKey ?? activeKey,
        period: data.period ?? period,
        baseBudgetGoal: data.baseBudgetGoal ?? null,
        addedBudgetGoal: data.addedBudgetGoal ?? null,
        markup:
          typeof data.markup === 'number' && Number.isFinite(data.markup)
            ? data.markup
            : null,
        timeZone:
          typeof data.timeZone === 'string' && data.timeZone
            ? data.timeZone
            : DEFAULT_TIME_ZONE,
        frozen: data.frozen === true,
        frozenAt: data.frozenAt ?? null,
        reopened: data.reopened === true,
        baseCarryover: data.baseCarryover ?? null,
        addedCarryover: data.addedCarryover ?? null,
        priorOverUnder: data.priorOverUnder ?? null,
        ads: Array.isArray(data.ads) ? data.ads : [],
        siblingsByName: data.siblingsByName,
      });
      toast.success(
        clear
          ? 'Carryover removed.'
          : `Carried last month's over/under into ${bucket === 'base' ? 'Base' : 'Added'}.`,
      );
    } catch {
      toast.error('Could not update carryover.');
    } finally {
      setApplyingCarryover(false);
    }
  };

  // ── Copy from another period ──
  const handleCopyFrom = async (
    fromPeriod: string,
    adIds: string[] | undefined,
    fields: CopyFieldOptions,
  ) => {
    if (!activeKey || !fromPeriod || fromPeriod === period) return;
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/meta-ads-pacer/${activeKey}/copy-from`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromPeriod,
          to: period,
          fields,
          ...(adIds && adIds.length > 0 ? { adIds } : {}),
        }),
      });
      if (!res.ok) throw new Error('copy failed');
      const updated = (await res.json()) as PacerPlan;
      setPlan({
        accountKey: updated.accountKey ?? activeKey,
        period: updated.period ?? period,
        baseBudgetGoal: updated.baseBudgetGoal ?? null,
        addedBudgetGoal: updated.addedBudgetGoal ?? null,
        markup:
          typeof updated.markup === 'number' && Number.isFinite(updated.markup)
            ? updated.markup
            : null,
        timeZone:
          typeof updated.timeZone === 'string' && updated.timeZone
            ? updated.timeZone
            : DEFAULT_TIME_ZONE,
        frozen: updated.frozen === true,
        frozenAt: updated.frozenAt ?? null,
        reopened: updated.reopened === true,
        baseCarryover: updated.baseCarryover ?? null,
        addedCarryover: updated.addedCarryover ?? null,
        priorOverUnder: updated.priorOverUnder ?? null,
        ads: Array.isArray(updated.ads) ? updated.ads : [],
        siblingsByName: updated.siblingsByName,
      });
      lastSavedRef.current = JSON.stringify({
        baseBudgetGoal: updated.baseBudgetGoal,
        addedBudgetGoal: updated.addedBudgetGoal,
        ads: (updated.ads ?? []).map((a, i) => ({ ...a, position: i, period })),
      });
      // Refresh periods list (target now has ads)
      fetch(`/api/meta-ads-pacer/${activeKey}/periods`)
        .then((r) => (r.ok ? r.json() : { periods: [] }))
        .then((data: { periods: PeriodSummary[] }) =>
          setPeriodSummaries(Array.isArray(data?.periods) ? data.periods : []),
        )
        .catch(() => {});
      setSaveStatus('saved');
      markClean();
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch {
      setSaveStatus('error');
    }
  };

  // ── Activity log handlers (per-event endpoints) ──
  const onAddActivity = async (adId: string, text: string, file: File | null) => {
    if (!activeKey) return;
    let res: Response;
    if (file) {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('file', file);
      res = await fetch(`/api/meta-ads-pacer/${activeKey}/ads/${adId}/activity`, {
        method: 'POST',
        body: fd,
      });
    } else {
      res = await fetch(`/api/meta-ads-pacer/${activeKey}/ads/${adId}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    }
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(msg || `HTTP ${res.status}`);
    }
    const entry = (await res.json()) as ActivityEntry;
    setPlan((p) =>
      p
        ? {
            ...p,
            ads: p.ads.map((a) =>
              a.id === adId ? { ...a, activityLog: [...a.activityLog, entry] } : a,
            ),
          }
        : p,
    );
  };

  const onEditActivity = async (adId: string, entryId: string, text: string) => {
    if (!activeKey) return;
    const res = await fetch(
      `/api/meta-ads-pacer/${activeKey}/ads/${adId}/activity/${entryId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      },
    );
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(msg || `HTTP ${res.status}`);
    }
    const entry = (await res.json()) as ActivityEntry;
    setPlan((p) =>
      p
        ? {
            ...p,
            ads: p.ads.map((a) =>
              a.id === adId
                ? {
                    ...a,
                    activityLog: a.activityLog.map((x) =>
                      x.id === entryId ? entry : x,
                    ),
                  }
                : a,
            ),
          }
        : p,
    );
  };

  const onDeleteActivity = async (adId: string, entryId: string) => {
    if (!activeKey) return;
    const res = await fetch(
      `/api/meta-ads-pacer/${activeKey}/ads/${adId}/activity/${entryId}`,
      { method: 'DELETE' },
    );
    if (!res.ok) return;
    setPlan((p) =>
      p
        ? {
            ...p,
            ads: p.ads.map((a) =>
              a.id === adId
                ? { ...a, activityLog: a.activityLog.filter((x) => x.id !== entryId) }
                : a,
            ),
          }
        : p,
    );
  };

  // ── Header totals ──
  const totals = useMemo(() => {
    if (!plan) return { base: 0, added: 0, actual: 0 };
    let base = 0;
    let added = 0;
    let actual = 0;
    plan.ads.forEach((ad) => {
      const c = adContribution(ad);
      base += c.baseAllocation;
      added += c.addedAllocation;
      // §2: a resolved straddler counts its full run in its own month.
      actual += effectiveActual(ad);
    });
    return { base, added, actual };
  }, [plan]);

  // Account-wide pacing for the Pacer's scope-row "Spend Progress" readout —
  // lifted here (from the pacer panel) so the metrics can live in the scope
  // row. Live month = neutral progress; frozen = final variance. In-progress
  // lifetime ads are excluded from both sides (mirrors the Over/Under page).
  const pacerAccountPacing = useMemo<AccountPacing | null>(() => {
    if (!plan) return null;
    const nowMs = Date.now();
    const gross =
      (num(plan.baseBudgetGoal) ?? 0) + (num(plan.addedBudgetGoal) ?? 0);
    const carry =
      (num(plan.baseCarryover) ?? 0) + (num(plan.addedCarryover) ?? 0);
    const target = effectiveSpendTarget(gross, effMarkupOf(plan.markup), carry);
    let ipLifeActual = 0;
    let ipLifeAlloc = 0;
    for (const ad of plan.ads) {
      if (!isLifetimeInProgress(ad, nowMs, plan.timeZone)) continue;
      ipLifeActual += effectiveActual(ad);
      ipLifeAlloc += num(ad.allocation) ?? 0;
    }
    const baseTarget = target - ipLifeAlloc;
    const baseSpent = totals.actual - ipLifeActual;
    if (baseTarget <= 0) return null;
    if (plan.frozen) {
      const pct = (baseSpent / baseTarget) * 100;
      const delta = pct - 100;
      const status =
        Math.abs(delta) < 0.5 ? 'on-track' : delta > 0 ? 'over' : 'under';
      return { mode: 'final', pct, status, spent: baseSpent, target: baseTarget, dayElapsed: 0, dayTotal: 0 };
    }
    const now = new Date(nowMs);
    const [py, pm] = plan.period.split('-').map(Number);
    const dayTotal = new Date(py, pm, 0).getDate();
    const todayMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dayElapsed =
      todayMonth === plan.period ? now.getDate() : todayMonth > plan.period ? dayTotal : 0;
    return { mode: 'progress', pct: (baseSpent / baseTarget) * 100, status: 'neutral', spent: baseSpent, target: baseTarget, dayElapsed, dayTotal };
  }, [plan, totals.actual]);

  // Bulk "Set all dailies to Rec." — lifted here (from the pacer panel) so the
  // button can sit beside Sync in the shared action cluster. Applies the
  // recommended daily to every visible non-lifetime, non-stopped ad with a
  // valid recDaily; shows a per-ad before → after preview first.
  const pacerVisibleAds = useMemo(
    () => (plan ? applyFilters(plan.ads, filters, currentUserId) : []),
    [plan, filters, currentUserId],
  );
  const bulkSetDailies = async () => {
    if (!plan || plan.frozen) return;
    const nowMs = Date.now();
    const candidates = pacerVisibleAds.filter((ad) => {
      if (ad.budgetType !== 'Daily') return false;
      if (ad.adStatus === 'Off' || ad.adStatus === 'Completed Run') return false;
      const c = buildPacerCalc(ad, nowMs, plan.timeZone);
      return c.daysLeft > 0 && c.budget > 0 && c.recDaily > 0;
    });
    if (candidates.length === 0) {
      toast.error('No visible ads have a recommended daily to apply');
      return;
    }
    const bigJumps = candidates.filter((ad) => {
      const current = num(ad.pacerDailyBudget) ?? 0;
      if (current <= 0) return false;
      const rec = buildPacerCalc(ad, nowMs, plan.timeZone).recDaily;
      return Math.abs(rec - current) / current > 0.2;
    });
    const adWord = candidates.length === 1 ? 'ad' : 'ads';
    const rows = candidates.map((ad) => {
      const current = num(ad.pacerDailyBudget) ?? 0;
      const rec = buildPacerCalc(ad, nowMs, plan.timeZone).recDaily;
      return {
        id: ad.id,
        name: ad.name || 'Untitled Ad',
        current,
        rec,
        isBig: current > 0 && Math.abs(rec - current) / current > 0.2,
      };
    });
    const body = (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[var(--foreground)]">
                  {r.name}
                </div>
                {r.isBig && (
                  <span
                    className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ background: 'rgba(245,158,11,0.15)', color: COLORS.warn }}
                  >
                    <ExclamationTriangleIcon className="h-3 w-3" />
                    &gt;20% jump
                  </span>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2 text-sm">
                <span className="text-[var(--muted-foreground)]">
                  {r.current > 0 ? `${fmt(r.current)}/day` : 'not set'}
                </span>
                <span className="text-[var(--muted-foreground)]">→</span>
                <span className="font-bold" style={{ color: 'var(--primary)' }}>
                  {fmt(r.rec)}/day
                </span>
              </div>
            </div>
          ))}
        </div>
        {bigJumps.length > 0 && (
          <div
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
            style={{ background: 'rgba(245,158,11,0.1)', color: COLORS.warn }}
          >
            <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              {bigJumps.length}{' '}
              {bigJumps.length === 1 ? 'change is a' : 'changes are'} &gt;20% jump
              — large changes can reset Meta&apos;s learning phase.
            </span>
          </div>
        )}
      </div>
    );
    const ok = await confirm({
      title: 'Set dailies to recommended',
      message: `This will set the daily budget on ${candidates.length} ${adWord}:`,
      body,
      confirmLabel: `Apply to ${candidates.length} ${adWord}`,
    });
    if (!ok) return;
    const candidateIds = new Set(candidates.map((a) => a.id));
    setPlan({
      ...plan,
      ads: plan.ads.map((ad) => {
        if (!candidateIds.has(ad.id)) return ad;
        const c = buildPacerCalc(ad, nowMs, plan.timeZone);
        return { ...ad, pacerDailyBudget: c.recDaily.toFixed(2) };
      }),
    });
    toast.success(
      `Set daily budget on ${candidates.length} ad${candidates.length === 1 ? '' : 's'} to recommended`,
    );
  };

  // Most-recent Meta spend sync across the plan's ads (ISO strings compare
  // chronologically) — surfaced in the Sync button's tooltip.
  const lastSyncedAt = useMemo(
    () =>
      plan
        ? plan.ads.reduce<string | null>((latest, ad) => {
            if (!ad.pacerSyncedAt) return latest;
            return !latest || ad.pacerSyncedAt > latest ? ad.pacerSyncedAt : latest;
          }, null)
        : null,
    [plan],
  );

  // Pacer action buttons (change/budget log + set-all-dailies + Meta
  // import/sync). Built once here so they can render either in the scope row
  // (summary / over-under sub-tabs) or inside the pacer panel's "Spend Pacing"
  // header (passed via headerActions) — wherever the swap puts them per sub-tab.
  const pacerActions =
    mode === 'pacer' && activeKey ? (
      <div className="flex items-center justify-end gap-3 flex-wrap">
        <Tooltip label="Change log" placement="bottom">
          <button
            type="button"
            onClick={() => setChangeLogOpen(true)}
            aria-label="Change log"
            className="inline-flex items-center justify-center text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <ClockIcon className="w-6 h-6" />
          </button>
        </Tooltip>
        <Tooltip label="Budget Log" placement="bottom">
          <button
            type="button"
            onClick={() => setBudgetLogOpen(true)}
            aria-label="Budget Log"
            className="inline-flex items-center justify-center text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <ClipboardDocumentListIcon className="w-6 h-6" />
          </button>
        </Tooltip>
        {/* Set all dailies to Rec. — icon-only secondary, paired with Sync.
            Pacer sub-tab only (where the dailies table lives); lights up to
            the soft primary color on hover. */}
        {pacerTab === 'pacer' && !plan?.frozen && (
          <Tooltip label="Set all dailies to recommended" placement="bottom">
            <button
              type="button"
              onClick={bulkSetDailies}
              aria-label="Set all dailies to recommended"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/10 hover:text-[var(--primary)]"
            >
              <BoltIcon className="w-4 h-4" />
            </button>
          </Tooltip>
        )}
        {/* Sync — icon-only secondary, sits to the left of Import. */}
        <Tooltip
          label={
            <span className="block">
              <span className="block">
                {plan?.frozen
                  ? 'Frozen — reopen to re-sync'
                  : 'Sync actual spend from Meta'}
              </span>
              {lastSyncedAt && (
                <span className="mt-0.5 block text-[var(--muted-foreground)]">
                  Last synced {fmtSyncedAgo(lastSyncedAt)}
                </span>
              )}
            </span>
          }
          placement="bottom"
        >
          <button
            type="button"
            onClick={() => handleSyncMeta()}
            disabled={syncingMeta || !!plan?.frozen}
            aria-label="Sync from Meta"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowPathIcon className={`w-4 h-4 ${syncingMeta ? 'animate-spin' : ''}`} />
          </button>
        </Tooltip>
        {/* Import — primary, white Meta badge. */}
        <Tooltip
          label={
            plan?.frozen
              ? 'This month is frozen — reopen it to import'
              : 'Bring existing Meta ad sets into this month as rows'
          }
          placement="bottom"
        >
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          disabled={!!plan?.frozen}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--primary)]/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <MetaBrandIcon className="w-3.5 h-3.5 brightness-0 invert" />
          Import from Meta
        </button>
        </Tooltip>
      </div>
    ) : null;

  const hasTabs = mode === 'pacer' || (mode === 'planner' && !!activeKey);

  // Carryover prompt (Change 7) — fold last month's settled over/under into
  // this month's spend target, opt-in, per bucket. Never touches the client
  // budget goal. Rendered up in the account scope row (planner only) so it
  // doesn't add a dedicated row above the budget cards.
  const carryoverNotice =
    activeKey && plan && !plan.frozen && mode === 'planner' && plannerTab === 'planner'
      ? (() => {
          const prior = plan.priorOverUnder;
          const appliedBase = num(plan.baseCarryover);
          const appliedAdded = num(plan.addedCarryover);
          const applied = appliedBase != null || appliedAdded != null;
          // Always surface an unapplied prior over/under so you can decide
          // whether to fold it in — even below the threshold. Only hide when
          // there's nothing meaningful to show.
          if (!applied && (!prior || Math.abs(prior.variance) < 0.005)) {
            return null;
          }
          const fromLabel = fmtPeriodShort(shiftPeriod(period, -1));
          if (applied) {
            const amt = appliedBase != null ? appliedBase : appliedAdded ?? 0;
            const bucket = appliedBase != null ? 'base' : 'added';
            return (
              <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ArrowPathIcon className="w-4 h-4 flex-shrink-0 text-[var(--primary)]" />
                  <span className="text-xs text-[var(--foreground)]">
                    Carryover applied:{' '}
                    <span className="font-semibold">
                      {amt >= 0 ? '+' : '−'}
                      {fmt(Math.abs(amt))}
                    </span>{' '}
                    to {bucket === 'base' ? 'Base' : 'Added'} (from {fromLabel}).
                    The client budget is unchanged.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleApplyCarryover(bucket, true)}
                  disabled={applyingCarryover}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Remove
                </button>
              </div>
            );
          }
          const variance = prior!.variance;
          const under = variance < 0;
          const carry = prior!.carryover;
          const prominent = prior!.exceedsThreshold && !carryoverDismissed;
          if (!prominent) {
            return (
              <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-4 py-2">
                <div className="flex items-center gap-2 min-w-0 text-xs text-[var(--muted-foreground)]">
                  <ScaleIcon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>
                    <span className="font-semibold text-[var(--foreground)]">
                      {fromLabel}
                    </span>{' '}
                    {under ? 'underspent' : 'overspent'} by{' '}
                    <span className="font-semibold text-[var(--foreground)]">
                      {fmt(Math.abs(variance))}
                    </span>{' '}
                    vs target.
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <select
                    value={carryoverBucket}
                    onChange={(e) =>
                      setCarryoverBucket(e.target.value === 'added' ? 'added' : 'base')
                    }
                    className="px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--input)] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
                    aria-label="Carryover bucket"
                  >
                    <option value="base">Base</option>
                    <option value="added">Added</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => handleApplyCarryover(carryoverBucket, false)}
                    disabled={applyingCarryover}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {applyingCarryover
                      ? 'Applying…'
                      : `Apply ${carry >= 0 ? '+' : '−'}${fmt(Math.abs(carry))}`}
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div
              className="flex items-center justify-between gap-3 flex-wrap rounded-xl border px-4 py-2.5"
              style={{ borderColor: `${COLORS.warn}66`, background: 'rgba(245,158,11,0.06)' }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <ScaleIcon className="w-4 h-4 flex-shrink-0" style={{ color: COLORS.warn }} />
                <div className="min-w-0 text-xs text-[var(--foreground)]">
                  <span className="font-semibold">{fromLabel}</span>{' '}
                  {under ? 'underspent' : 'overspent'} by{' '}
                  <span className="font-semibold" style={{ color: under ? COLORS.warn : COLORS.error }}>
                    {fmt(Math.abs(variance))}
                  </span>{' '}
                  vs target — exceeds the {fmt(CARRYOVER_THRESHOLD)} threshold.
                  <span className="text-[var(--muted-foreground)]">
                    {' '}Apply{' '}
                    <span className="font-semibold text-[var(--foreground)]">
                      {carry >= 0 ? '+' : '−'}
                      {fmt(Math.abs(carry))}
                    </span>{' '}
                    to this month&apos;s spend target?
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <select
                  value={carryoverBucket}
                  onChange={(e) =>
                    setCarryoverBucket(e.target.value === 'added' ? 'added' : 'base')
                  }
                  className="px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--input)] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
                  aria-label="Carryover bucket"
                >
                  <option value="base">Base</option>
                  <option value="added">Added</option>
                </select>
                <button
                  type="button"
                  onClick={() => handleApplyCarryover(carryoverBucket, false)}
                  disabled={applyingCarryover}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary)] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {applyingCarryover ? 'Applying…' : 'Apply'}
                </button>
                <button
                  type="button"
                  onClick={() => setCarryoverDismissed(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
                >
                  Leave as-is
                </button>
              </div>
            </div>
          );
        })()
      : null;

  return (
    <PacerReadOnlyContext.Provider value={!!plan?.frozen}>
    <div className="animate-fade-in-up">
      {/* Page header — title row + sub-tabs are pinned together inside one
          sticky element so the tabs don't scroll away. */}
      <div
        className={`page-sticky-header pad-on-scroll ${hasTabs ? 'has-tabs ' : ''}${
          mode === 'pacer' ? 'mb-8' : 'mb-6'
        }`}
      >
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          {/* Left: title */}
          <div className="flex items-center gap-3 min-w-0">
            <MetaBrandIcon className="w-8 h-8 flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-2xl font-bold">Meta Ads</h2>
              <p className="text-[var(--muted-foreground)] text-sm mt-0.5">
                {mode === 'planner'
                  ? 'Plan and allocate your monthly Meta ad budgets'
                  : 'Track spend pacing across the active period'}
              </p>
            </div>
          </div>

          {/* Center: Plan / Pace mode switch — consolidates the former Ad
              Planner + Ad Pacer pages. Each mode keeps its own sub-tabs. */}
          <div className="flex justify-center">
            <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5">
              {(['planner', 'pacer'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === m
                      ? 'bg-[var(--primary)] text-white'
                      : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  {m === 'planner' ? 'Plan' : 'Pace'}
                </button>
              ))}
            </div>
          </div>

          {/* Right: notes + month + filters */}
          <div className="flex items-center justify-end gap-3 flex-wrap">
            {activeKey && (
              <AccountNotesButton
                count={notesCount}
                onClick={() => setNotesOpen(true)}
                ariaLabel={`Open notes for ${activeAccount?.dealer ?? activeKey}`}
              />
            )}
            <PeriodSelector period={period} onChange={setPeriod} />
            <button
              type="button"
              onClick={() => setFilterSidebarOpen((o) => !o)}
              aria-pressed={filterSidebarOpen}
              aria-expanded={filterSidebarOpen}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                filterSidebarOpen
                  ? 'border-[var(--primary)] bg-[var(--primary)]/12 text-[var(--primary)]'
                  : 'border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--muted)]'
              }`}
            >
              <FunnelIcon className="w-3.5 h-3.5" />
              Filters
              {activeFilterCount(filters) > 0 && (
                <span
                  className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold"
                  style={{ background: 'var(--primary)', color: 'white' }}
                >
                  {activeFilterCount(filters)}
                </span>
              )}
            </button>
          </div>
        </div>

      {/* Sub-tabs — pinned inside the sticky header so they don't scroll away. */}
      {mode === 'pacer' && (
        <div className="mt-4 flex items-center gap-1 border-b border-[var(--border)]">
          {activeKey && (
            <>
              <button
                type="button"
                onClick={() => setPacerTab('summary')}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  pacerTab === 'summary'
                    ? 'border-[var(--primary)] text-[var(--primary)]'
                    : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                <TableCellsIcon className="w-3.5 h-3.5" />
                Summary
              </button>
              <button
                type="button"
                onClick={() => setPacerTab('pacer')}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  pacerTab === 'pacer'
                    ? 'border-[var(--primary)] text-[var(--primary)]'
                    : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                <AdjustmentsHorizontalIcon className="w-3.5 h-3.5" />
                Pacer
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setPacerTab('compare')}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              pacerTab === 'compare'
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            <ScaleIcon className="w-3.5 h-3.5" />
            Over/Under Spend
          </button>
        </div>
      )}

      {/* Planner sub-tabs — Planner + Reconciliation, mirroring the Pacer
          page's tab row. Only shown when an account is selected, since the
          Reconciliation view needs an account. */}
      {mode === 'planner' && activeKey && (
        <div className="mt-4 flex items-center gap-1 border-b border-[var(--border)]">
          <button
            type="button"
            onClick={() => setPlannerTab('planner')}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              plannerTab === 'planner'
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            <ClipboardDocumentListIcon className="w-3.5 h-3.5" />
            Planner
          </button>
          <button
            type="button"
            onClick={() => setPlannerTab('reconcile')}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              plannerTab === 'reconcile'
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            <InvestmentIcon className="w-3.5 h-3.5" />
            Reconciliation
          </button>
        </div>
      )}
      </div>

      {/* Scope row — avatar + account name + status battery on the left;
          pacer actions on the right. The carryover banner renders full-width
          directly below (planner), so the row hugs it when present. */}
      <div
        className={`flex items-start justify-between gap-4 flex-wrap ${
          carryoverNotice ? 'mb-4' : 'mb-10'
        }`}
      >
        {activeKey ? (
          <div className="flex items-center gap-3 min-w-0">
            <AccountAvatar
              name={activeAccount?.dealer ?? activeKey}
              accountKey={activeKey}
              storefrontImage={activeAccount?.storefrontImage}
              logos={activeAccount?.logos}
              size={56}
              className="rounded-xl border border-[var(--border)] bg-[var(--muted)] flex-shrink-0"
            />
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="text-2xl font-bold text-[var(--foreground)] leading-tight">
                {activeAccount?.dealer || activeKey || '—'}
              </span>
              {plan && plan.ads.length > 0 && <StatusBattery ads={plan.ads} />}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 min-w-0">
            <span className="text-sm text-[var(--muted-foreground)]">
              All accounts overview
            </span>
          </div>
        )}

        {/* Pacer scope-row right side: the Pacer sub-tab shows the spend
            metrics here (its action buttons moved into the "Spend Pacing"
            header). The other Pacer sub-tabs keep the action buttons here. */}
        {mode === 'pacer' &&
          activeKey &&
          (pacerTab === 'pacer' ? (
            <PacerSpendTotals
              base={totals.base}
              added={totals.added}
              actual={totals.actual}
              pacing={pacerAccountPacing}
            />
          ) : (
            pacerActions
          ))}
      </div>

      {/* Carryover prompt — full-width row directly under the account scope
          (planner only, when present) so its text never wraps. */}
      {carryoverNotice && <div className="mb-6">{carryoverNotice}</div>}

      {/* Frozen-month banner (Change 5). A closed month is a read-only,
          immutable snapshot of what was actually managed; admins can reopen
          it to correct, which keeps the original snapshot as the record. */}
      {activeKey && plan?.frozen && (
        <div
          className="mb-6 flex items-center justify-between gap-3 flex-wrap rounded-xl border px-4 py-3"
          style={{ borderColor: COLORS.warn, background: 'rgba(245,158,11,0.08)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <LockClosedIcon
              className="w-4 h-4 flex-shrink-0"
              style={{ color: COLORS.warn }}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--foreground)]">
                {fmtPeriodLong(period)} is frozen — closed month
              </div>
              <div className="text-[11px] text-[var(--muted-foreground)]">
                Read-only snapshot of what was managed
                {plan.frozenAt ? ` · frozen ${fmtSyncedAgo(plan.frozenAt)}` : ''}.
                Editing and Meta sync are disabled.
              </div>
            </div>
          </div>
          <Tooltip label="Reopen this month for corrections (admin). The original snapshot is kept.">
          <button
            type="button"
            onClick={handleReopenMonth}
            disabled={reopening}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowPathIcon
              className={`w-3.5 h-3.5 ${reopening ? 'animate-spin' : ''}`}
            />
            {reopening ? 'Reopening…' : 'Reopen month'}
          </button>
          </Tooltip>
        </div>
      )}

      {/* Reopened closed month — editable for correction; prompt to re-freeze
          when done so it relocks as a faithful record. */}
      {activeKey && plan?.reopened && (
        <div
          className="mb-6 flex items-center justify-between gap-3 flex-wrap rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <ExclamationTriangleIcon
              className="w-4 h-4 flex-shrink-0"
              style={{ color: COLORS.warn }}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--foreground)]">
                {fmtPeriodLong(period)} reopened — closed month, editing enabled
              </div>
              <div className="text-[11px] text-[var(--muted-foreground)]">
                Changes save normally. Re-freeze when finished to lock it back as
                the record of what happened.
              </div>
            </div>
          </div>
          <Tooltip label="Re-freeze this month, locking it read-only again">
          <button
            type="button"
            onClick={handleRefreezeMonth}
            disabled={reopening}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LockClosedIcon className="w-3.5 h-3.5" />
            {reopening ? 'Working…' : 'Re-freeze month'}
          </button>
          </Tooltip>
        </div>
      )}

      {/* Body — budget header + content + inline filter sidebar all share
          the same 2-col grid so the header rows shrink alongside the body
          when the filter panel opens. Layout applies on both the
          per-account view and the admin overview. */}
      <div
        className={
          filterSidebarOpen
            ? 'grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start'
            : ''
        }
      >
        <div className="min-w-0">
          {/* Budget header (Total + Base/Added) — only on the Planner tab */}
          {activeKey && plan && mode === 'planner' && plannerTab === 'planner' && (
            <div className="mb-10 space-y-5">
              <TotalAllocationHeader plan={plan} />
              <div className="flex items-start gap-5 flex-wrap">
                <BudgetPanel
                  title="Base Budget"
                  source="base"
                  color={COLORS.base}
                  goalKey="baseBudgetGoal"
                  plan={plan}
                  onChange={setPlan}
                />
                <BudgetPanel
                  title="Added Budget"
                  source="added"
                  color={COLORS.added}
                  goalKey="addedBudgetGoal"
                  plan={plan}
                  onChange={setPlan}
                />
              </div>
            </div>
          )}

          {!activeKey ? (
            mode === 'pacer' && pacerTab === 'compare' ? (
              <div className="glass-section-card rounded-xl px-7 py-7">
                <ComparePanel accountKey={null} period={period} />
              </div>
            ) : (
              <OverviewView
                period={period}
                filters={filters}
                currentUserId={currentUserId}
                onOpenAccount={(key) =>
                  setAccount({ mode: 'account', accountKey: key })
                }
                users={users}
                accounts={overviewAccounts}
                loadError={overviewError}
              />
            )
          ) : !loaded ? (
            <div className="text-center py-16 text-[var(--muted-foreground)] text-sm">
              Loading saved data…
            </div>
          ) : loadError ? (
            <div className="glass-section-card rounded-xl text-center py-16 px-6">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <ExclamationTriangleIcon className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-[var(--foreground)] text-sm font-medium mb-1">
                Could not load this account&apos;s planner data.
              </p>
              <p className="text-[var(--muted-foreground)] text-xs mb-1">{loadError}</p>
              <p className="text-[var(--muted-foreground)] text-xs">
                If you just deployed the new schema, restart the dev server so the Prisma
                client picks up the new models, then refresh.
              </p>
            </div>
          ) : !plan ? null : (() => {
            // Ad Planner + Pacer's Summary tab render flush (no outer card)
            // so the inner table reads as the page-level content. Pacer's
            // Pacer + Over/Under Spend tabs keep the glass-section-card
            // chrome since their content benefits from the visual frame.
            const flat =
              (mode === 'planner' && plannerTab === 'planner') ||
              (mode === 'pacer' && (pacerTab === 'summary' || pacerTab === 'pacer'));
            const wrapperClass = flat
              ? ''
              : 'glass-section-card rounded-xl px-7 py-7';
            const inner =
              mode === 'planner' ? (
                plannerTab === 'reconcile' ? (
                  <ReconciliationPanel accountKey={activeKey} />
                ) : (
                  <AdPlannerPanel
                    plan={plan}
                    period={period}
                    users={users}
                    filters={filters}
                    onFiltersChange={setFilters}
                    currentUserId={currentUserId}
                    periodSummaries={periodSummaries}
                    onChange={setPlan}
                    onCopyFrom={handleCopyFrom}
                    onImport={plan?.frozen ? undefined : () => setImportOpen(true)}
                    onModalOpenChange={setEditorOpen}
                    onAddActivity={onAddActivity}
                    onEditActivity={onEditActivity}
                    onDeleteActivity={onDeleteActivity}
                  />
                )
              ) : pacerTab === 'pacer' ? (
                <BudgetPacerPanel
                  plan={plan}
                  filters={filters}
                  onFiltersChange={setFilters}
                  currentUserId={currentUserId}
                  onChange={setPlan}
                  accountKey={activeKey}
                  headerActions={pacerActions}
                />
              ) : pacerTab === 'compare' ? (
                <ComparePanel accountKey={activeKey} period={period} />
              ) : (
                <SummaryPanel plan={plan} />
              );
            return flat ? inner : <div className={wrapperClass}>{inner}</div>;
          })()}
        </div>

        {/* Inline filter sidebar — renders on both per-account view
            (ads pulled from `plan.ads`) and the admin overview (ads
            flattened from `overviewAccounts`). The slide-in/out
            animation comes from the className transitions. */}
        <MetaAdsPacerFilterSidebar
          open={filterSidebarOpen}
          inline
          onClose={() => setFilterSidebarOpen(false)}
          filters={filters}
          onChange={setFilters}
          users={users}
          ads={activeKey ? plan?.ads ?? [] : overviewAds}
          currentUserId={currentUserId}
          className={`glass-section-card pacer-ad-card w-full transition-[opacity,transform,max-height] duration-300 ease-out lg:sticky lg:top-24 lg:w-[360px] ${
            filterSidebarOpen
              ? 'pointer-events-auto max-h-[calc(100vh-8rem)] translate-x-0 opacity-100 animate-slide-in-right'
              : 'pointer-events-none max-h-0 translate-x-4 opacity-0 hidden'
          }`}
        />
      </div>

      {/* Account-level notes modal — opened from the chat icon next to
          the period selector (subaccount view) or the chat icon on
          each account row (admin overview). */}
      {notesOpen && activeKey && (
        <AccountNotesDrawer
          accountKey={activeKey}
          accountLabel={activeAccount?.dealer ?? activeKey}
          period={period}
          users={users}
          currentUserId={currentUserId}
          onClose={() => setNotesOpen(false)}
          onCountChange={setNotesCount}
        />
      )}
      {/* Budget Log + Change Log drawers — lifted here so the scope-row icon
          buttons work across every pacer sub-tab. */}
      {budgetLogOpen && activeKey && plan && (
        <BudgetLogDrawer
          accountKey={activeKey}
          accountLabel={activeAccount?.dealer ?? activeKey}
          period={period}
          adsSnapshot={adsSnapshot}
          users={users}
          currentUserId={currentUserId}
          onClose={() => setBudgetLogOpen(false)}
        />
      )}
      {changeLogOpen && activeKey && (
        <ChangeLogDrawer
          accountKey={activeKey}
          accountLabel={activeAccount?.dealer ?? activeKey}
          period={period}
          onClose={() => setChangeLogOpen(false)}
        />
      )}
      {importOpen && activeKey && (
        <ImportFromMetaModal
          accountKey={activeKey}
          period={period}
          periodLabel={fmtPeriodLong(period)}
          users={users}
          onClose={() => setImportOpen(false)}
          onImported={handleImported}
        />
      )}
    </div>
    </PacerReadOnlyContext.Provider>
  );
}

// (Page-level entrypoints live at /tools/meta/ad-planner and /tools/meta/ad-pacer
// and import this component as `MetaAdsPlannerTool` with the appropriate `mode`.)
