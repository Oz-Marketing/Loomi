'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalculatorIcon,
  CalendarIcon,
  ChartBarIcon,
  CheckBadgeIcon,
  CheckIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PaintBrushIcon,
  TrashIcon,
  UserCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { MetaBrandIcon } from '@/components/icons/platform-logos';
import BulkActionDock from '@/components/bulk-action-dock';
import { toast } from '@/lib/toast';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import type {
  PacerAd,
  PacerPlan,
  PeriodSummary,
  DirectoryUser,
  ActivityEntry,
} from '@/lib/ad-pacer/types';
import { type PlanFilters, EMPTY_FILTERS, applyFilters } from '@/lib/ad-pacer/filters';
import { makeAd, newAdId } from '@/lib/ad-pacer/helpers';
import { fmtPeriodLong } from '@/lib/ad-pacer/period';
import {
  AdSummaryRow,
  AddPlanButton,
  EmptyPeriodState,
  AdEditorModal,
  BudgetCalculatorModal,
  useDragReorder,
  Tooltip,
  usePacerReadOnly,
} from '@/app/app/tools/_shared';
import { FilterStatus } from './FilterSidebar';
import { CopyPlanModal, type CopyFieldOptions } from './CopyPlanModal';
import { BulkEditModal, type BulkField } from './BulkEditModal';

// Meta Plan view: the ad-plan orchestration panel (table of AdSummaryRow,
// budget cards, editor modal, calculator, copy/bulk/import, filters, drag).
// Split out of MetaAdsPlannerTool to shrink the file.
export type EditorState =
  | { mode: 'create'; draft: PacerAd }
  | { mode: 'edit'; adId: string; original: PacerAd };

export function AdPlannerPanel({
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
                    Task Status
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
                  // Calc-local "Off — lock at spent" flips the planner status too.
                  ...(u.adStatus != null ? { adStatus: u.adStatus } : {}),
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
              label: 'Task Status',
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
