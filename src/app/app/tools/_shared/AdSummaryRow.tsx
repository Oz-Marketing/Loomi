'use client';

import { useState } from 'react';
import {
  Bars2Icon,
  DocumentDuplicateIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { DatePicker } from '@/components/ui/date-picker';
import type { PacerAd } from '@/lib/ad-pacer/types';
import {
  AD_COLORS,
  AD_STATUSES,
  AD_STATUS_COLORS,
  APPROVAL_STATUSES,
  APPROVAL_STATUS_COLORS,
  DESIGN_STATUSES,
  DESIGN_STATUS_COLORS,
} from '@/lib/ad-pacer/constants';
import {
  fmt,
  fmtDate,
  num,
  budgetTypeColor,
  budgetTypeTint,
  sourceColor,
  sourceTint,
  sourceLabel,
} from '@/lib/ad-pacer/helpers';
import { flightDatePresets, TODAY_PRESET } from '@/lib/ad-pacer/period';
import { googlePacingTypeLabel, isSharedBudget } from '@/lib/ad-pacer/google-pacer-calc';
import { usePacerReadOnly } from './pacer-read-only';
import { Tooltip } from './Tooltip';
import { FlightBar } from './FlightBar';
import { AdStatusPill, ApprovalPill, DesignPill } from './pills';
import { UpdatesIndicator } from './metrics';
import { CellEditor } from './CellEditor';
import { InlineMoneyCell, InlineTextCell } from './InlineEditCell';
import { StatusOptionList } from './StatusSelect';
import { BudgetTypeToggle, BudgetSourceToggle } from './toggles';
import { DollarInput } from './inputs';
import type { DragReorderApi, DropEdge } from './use-drag-reorder';

const GOOGLE_DAYS_PER_MONTH = 30.4;

// Borderless date trigger so a picker can sit in a table cell without looking
// like a form input. The cell content is the affordance; the calendar drops
// below on click.
const dateTriggerClass =
  'group -mx-1.5 -my-1 inline-flex max-w-full items-center rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/50';

/**
 * Ad name — clicking it opens the full editor (the name is the row's handle on
 * the whole ad, not just its title). Renaming is the pencil beside it, revealed
 * on row hover.
 */
function NameCell({
  ad,
  onUpdate,
  onOpen,
  onEditingChange,
}: {
  ad: PacerAd;
  onUpdate?: (next: PacerAd) => void;
  onOpen: () => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  return (
    <InlineTextCell
      ariaLabel={`Open details for ${ad.name || 'Untitled Ad'}`}
      value={ad.name}
      placeholder="Ad name…"
      disabled={!onUpdate}
      hugContent
      onTriggerClick={onOpen}
      editLabel="Rename ad"
      onEditingChange={onEditingChange}
      onCommit={(name) => onUpdate?.({ ...ad, name })}
      display={
        <span className="block truncate text-sm font-semibold text-[var(--foreground)]">
          {ad.name || 'Untitled Ad'}
        </span>
      }
    />
  );
}

/** Allocation — click to type the amount right in the cell. */
function AllocationCell({
  ad,
  onUpdate,
  dailyRate,
  onEditingChange,
}: {
  ad: PacerAd;
  onUpdate?: (next: PacerAd) => void;
  dailyRate: number | null;
  onEditingChange?: (editing: boolean) => void;
}) {
  const allocation = num(ad.allocation);
  return (
    <InlineMoneyCell
      ariaLabel="Actual spend amount"
      value={ad.allocation}
      disabled={!onUpdate}
      onEditingChange={onEditingChange}
      onCommit={(allocationNext) => onUpdate?.({ ...ad, allocation: allocationNext })}
      display={
        <span
          className="block whitespace-nowrap text-xs font-semibold"
          style={{ color: sourceColor(ad.budgetSource) }}
        >
          {allocation != null ? fmt(allocation) : '—'}
          {dailyRate != null && (
            <span className="block text-[10px] font-normal text-[var(--muted-foreground)]">
              {fmt(dailyRate)}/day avg
            </span>
          )}
        </span>
      }
    />
  );
}

/**
 * Compact list-view row for an ad in the Plan table. Every cell is editable in
 * place — click it and the field's control drops below; clicking the ad NAME
 * opens the full editor modal (the pencil beside it renames). Pure +
 * callback-driven (drag, open,
 * update, remove, clone, select are all props) so Meta + Google share it.
 */
export function AdSummaryRow({
  ad,
  index,
  onOpen,
  onUpdate,
  onRemove,
  onClone,
  dragProps,
  isDragging,
  isDropTarget,
  dropEdge,
  isSelected,
  onSelectToggle,
}: {
  ad: PacerAd;
  index: number;
  /** Opens the full ad editor modal (expand icon beside the name). */
  onOpen: () => void;
  /**
   * Commits an inline cell edit. Omit to render the row as display-only —
   * a frozen month also disables editing on its own via the read-only context.
   */
  onUpdate?: (next: PacerAd) => void;
  onRemove: (id: string) => void;
  onClone: (id: string) => void;
  dragProps?: ReturnType<DragReorderApi['rowProps']>;
  isDragging?: boolean;
  isDropTarget?: boolean;
  dropEdge?: DropEdge | null;
  isSelected: boolean;
  onSelectToggle: () => void;
  // Detailed view shows Design + Approvals columns; Basic hides them.
  // Must match the parent table's <th> set.
}) {
  const readOnly = usePacerReadOnly();
  const editable = !!onUpdate && !readOnly;
  // While a text/money field is open in this row, drop the drag handlers —
  // a native row drag beginning inside an input eats the text selection.
  const [inlineEditing, setInlineEditing] = useState(false);
  const allocation = num(ad.allocation);
  const updatesCount = ad.activityLog.length;
  // §2/§4 Google planner row extras: Daily/Total label, the genuinely-shared
  // badge, the daily-rate subline (monthly allocation ÷ 30.4), the channel-type
  // subline, and the §5 delivery flags. Meta rows ignore all of this.
  const isGoogle = ad.platform === 'google';
  const gPacingType = isGoogle
    ? googlePacingTypeLabel(ad.googleBudgetPeriod, ad.budgetType)
    : null;
  const gShared = isGoogle && isSharedBudget(ad.googleBudgetReferenceCount);
  const gDailyRate =
    isGoogle && gPacingType === 'Daily' && allocation != null
      ? allocation / GOOGLE_DAYS_PER_MONTH
      : null;
  const showTopLine = isDropTarget && dropEdge === 'top';
  const showBottomLine = isDropTarget && dropEdge === 'bottom';

  // Drop indicator for table rows: a 2px primary-colored box-shadow on the
  // top or bottom edge. Using box-shadow (instead of border) avoids shifting
  // the row's height during drag.
  const dropShadow = showTopLine
    ? 'inset 0 2px 0 0 var(--primary)'
    : showBottomLine
      ? 'inset 0 -2px 0 0 var(--primary)'
      : undefined;

  const budgetBadges = (
    <div className="flex items-center gap-1">
      <span
        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
        style={{
          background: budgetTypeTint(ad.budgetType),
          color: budgetTypeColor(ad.budgetType),
        }}
      >
        {gPacingType ?? ad.budgetType}
      </span>
      <span
        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
        style={{
          background: sourceTint(ad.budgetSource),
          color: sourceColor(ad.budgetSource),
        }}
      >
        {sourceLabel(ad.budgetSource)}
      </span>
      {gShared && (
        <span
          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(125,184,232,0.16)', color: '#7db8e8' }}
        >
          Shared{ad.googleBudgetReferenceCount ? ` ×${ad.googleBudgetReferenceCount}` : ''}
        </span>
      )}
    </div>
  );

  const flightDisplay = (
    <div className="flex items-center gap-2">
      <FlightBar ad={ad} />
      {isGoogle && ad.googleAdsDisapproved && (
        <span
          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap"
          style={{ background: 'rgba(248,113,113,0.16)', color: '#f87171' }}
        >
          Ads disapproved
        </span>
      )}
      {isGoogle && !ad.googleAdsDisapproved && ad.googleBudgetConstrained && (
        <span
          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap"
          style={{ background: 'rgba(125,184,232,0.16)', color: '#7db8e8' }}
        >
          Limited by budget
        </span>
      )}
    </div>
  );

  return (
    <tr
      {...(dragProps && !readOnly && !inlineEditing ? dragProps : {})}
      style={{ boxShadow: dropShadow }}
      className={`group border-b border-[var(--border)] last:border-b-0 transition-colors hover:bg-[var(--muted)]/50 ${
        readOnly ? '' : 'cursor-grab active:cursor-grabbing'
      } ${isSelected ? 'bg-[var(--primary)]/8' : ''} ${
        isDragging ? 'bg-[var(--primary)]/10' : ''
      }`}
    >
      {/* Drag hint + bulk-selection checkbox (clicking the box must not start
          an edit, so it stops propagation) */}
      <td
        className="w-14 pl-2 pr-1 py-2 align-middle"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1">
          {!readOnly && (
            <Bars2Icon
              aria-hidden="true"
              className="w-3.5 h-3.5 flex-shrink-0 rotate-90 text-[var(--muted-foreground)] opacity-0 transition-opacity group-hover:opacity-60"
            />
          )}
          <input
            type="checkbox"
            aria-label={`Select ${ad.name || 'Untitled Ad'}`}
            checked={isSelected}
            onChange={onSelectToggle}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 rounded border-[var(--border)] bg-[var(--input)] text-[var(--primary)] cursor-pointer accent-[var(--primary)]"
          />
        </div>
      </td>

      {/* Color + name (+ Google channel-type subline) + rename pencil */}
      {/* Wider than the other columns: it carries the name plus the rename
          affordance, and every other cell is nowrap so this one absorbs the
          table's flex. */}
      <td className="px-3 py-2 align-middle min-w-[300px] w-[38%]">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-2 h-2 rounded-sm flex-shrink-0"
            style={{ background: AD_COLORS[index % AD_COLORS.length] }}
          />
          <div className="min-w-0 flex-1">
            <NameCell
              ad={ad}
              onUpdate={onUpdate}
              onOpen={onOpen}
              onEditingChange={setInlineEditing}
            />
            {isGoogle && ad.googleChannelType && (
              <span className="block text-[11px] text-[var(--muted-foreground)] truncate">
                {ad.googleChannelType}
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Updates indicator (own column so icons align across rows; no header) */}
      <td className="w-10 px-2 py-2 align-middle">
        <UpdatesIndicator
          count={updatesCount}
          hasAttachments={ad.activityLog.some((e) => e.attachmentKey)}
        />
      </td>

      {/* Ad status */}
      <td className="px-3 py-2 align-middle whitespace-nowrap">
        <CellEditor
          label="Ad status"
          disabled={!onUpdate}
          display={<AdStatusPill status={ad.adStatus} />}
        >
          {(close) => (
            <StatusOptionList
              value={ad.adStatus}
              options={AD_STATUSES}
              colorMap={AD_STATUS_COLORS}
              maxHeight={200}
              onPick={(next) => {
                onUpdate?.({ ...ad, adStatus: next });
                close();
              }}
            />
          )}
        </CellEditor>
      </td>

      {/* Due date — user-set; muted dash when unset */}
      <td className="px-3 py-2 align-middle whitespace-nowrap text-xs">
        <DatePicker
          value={ad.dueDate}
          disabled={!editable}
          onChange={(v) => onUpdate?.({ ...ad, dueDate: v })}
          presets={[TODAY_PRESET]}
          className={dateTriggerClass}
          triggerContent={
            <span
              style={{
                color: ad.dueDate ? 'var(--foreground)' : 'var(--muted-foreground)',
              }}
            >
              {fmtDate(ad.dueDate)}
            </span>
          }
        />
      </td>

      {/* Budget type + source. Google's Daily/Total label comes from the
          campaign's own budget period, so only the source is editable there. */}
      <td className="px-3 py-2 align-middle whitespace-nowrap">
        <CellEditor
          label="Budget"
          disabled={!onUpdate}
          width={260}
          display={budgetBadges}
        >
          {() => (
            <div className="space-y-2.5">
              {!isGoogle && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Type
                  </div>
                  <BudgetTypeToggle
                    value={ad.budgetType}
                    onChange={(v) => onUpdate?.({ ...ad, budgetType: v })}
                  />
                </div>
              )}
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Source
                </div>
                <BudgetSourceToggle
                  value={ad.budgetSource}
                  onChange={(v) => onUpdate?.({ ...ad, budgetSource: v })}
                />
              </div>
              {ad.budgetSource === 'split' && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Base portion
                  </div>
                  <DollarInput
                    value={ad.splitBaseAmount}
                    onChange={(v) =>
                      onUpdate?.({ ...ad, splitBaseAmount: v || null })
                    }
                    placeholder="0.00"
                  />
                </div>
              )}
            </div>
          )}
        </CellEditor>
      </td>

      {/* Allocation (+ Google daily-rate subline: monthly ÷ 30.4) */}
      <td className="px-3 py-2 align-middle">
        <AllocationCell
          ad={ad}
          onUpdate={onUpdate}
          dailyRate={gDailyRate}
          onEditingChange={setInlineEditing}
        />
      </td>

      {/* Run dates (status-colored progress bar) + §5 Google delivery flags */}
      <td className="px-3 py-2 align-middle">
        <DatePicker
          mode="range"
          value={{ start: ad.flightStart, end: ad.flightEnd }}
          disabled={!editable}
          onChange={(r) =>
            onUpdate?.({ ...ad, flightStart: r.start, flightEnd: r.end })
          }
          presets={flightDatePresets(ad.period)}
          className={dateTriggerClass}
          triggerContent={flightDisplay}
        />
      </td>

      <>
          {/* Design */}
          <td className="px-3 py-2 align-middle whitespace-nowrap">
            <CellEditor
              label="Design status"
              disabled={!onUpdate}
              display={<DesignPill status={ad.designStatus} />}
            >
              {(close) => (
                <StatusOptionList
                  value={ad.designStatus}
                  options={DESIGN_STATUSES}
                  colorMap={DESIGN_STATUS_COLORS}
                  maxHeight={200}
                  onPick={(next) => {
                    onUpdate?.({ ...ad, designStatus: next });
                    close();
                  }}
                />
              )}
            </CellEditor>
          </td>

          {/* Approvals — internal + client in one popover */}
          <td className="px-3 py-2 align-middle whitespace-nowrap">
            <CellEditor
              label="Approvals"
              disabled={!onUpdate}
              width={260}
              display={
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] w-5 flex-shrink-0">
                      Int
                    </span>
                    <ApprovalPill status={ad.internalApproval} />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] w-5 flex-shrink-0">
                      Cli
                    </span>
                    <ApprovalPill status={ad.clientApproval} />
                  </div>
                </div>
              }
            >
              {() => (
                <div className="space-y-2.5">
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      Internal
                    </div>
                    <StatusOptionList
                      value={ad.internalApproval}
                      options={APPROVAL_STATUSES}
                      colorMap={APPROVAL_STATUS_COLORS}
                      maxHeight={200}
                      onPick={(next) =>
                        onUpdate?.({ ...ad, internalApproval: next })
                      }
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      Client
                    </div>
                    <StatusOptionList
                      value={ad.clientApproval}
                      options={APPROVAL_STATUSES}
                      colorMap={APPROVAL_STATUS_COLORS}
                      maxHeight={200}
                      onPick={(next) =>
                        onUpdate?.({ ...ad, clientApproval: next })
                      }
                    />
                  </div>
                </div>
              )}
            </CellEditor>
          </td>
      </>

      {/* Hover-only actions — hidden on a frozen month (read-only). */}
      <td className="px-3 py-2 align-middle whitespace-nowrap text-right">
        {!readOnly && (
          <span className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <Tooltip label="Clone ad">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClone(ad.id);
              }}
              className="text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--muted)] rounded p-1 transition-colors"
              aria-label="Clone ad"
            >
              <DocumentDuplicateIcon className="w-4 h-4" />
            </button>
            </Tooltip>
            <Tooltip label="Remove ad">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(ad.id);
              }}
              className="text-[var(--muted-foreground)] hover:text-red-400 hover:bg-[var(--muted)] rounded p-1 transition-colors"
              aria-label="Remove ad"
            >
              <TrashIcon className="w-4 h-4" />
            </button>
            </Tooltip>
          </span>
        )}
      </td>
    </tr>
  );
}
