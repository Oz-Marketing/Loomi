'use client';

import { DocumentDuplicateIcon, TrashIcon } from '@heroicons/react/24/outline';
import type { PacerAd } from '@/lib/ad-pacer/types';
import { AD_COLORS } from '@/lib/ad-pacer/constants';
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
import { googlePacingTypeLabel, isSharedBudget } from '@/lib/ad-pacer/google-pacer-calc';
import { usePacerReadOnly } from './pacer-read-only';
import { Tooltip } from './Tooltip';
import { FlightBar } from './FlightBar';
import { AdStatusPill, ApprovalPill, DesignPill } from './pills';
import { UpdatesIndicator } from './metrics';
import type { DragReorderApi, DropEdge } from './use-drag-reorder';

const GOOGLE_DAYS_PER_MONTH = 30.4;

/**
 * Compact list-view row for an ad in the Plan table. Click opens the editor;
 * hover reveals clone/remove. Pure + callback-driven (drag, click, remove,
 * clone, select are all props) so Meta + Google share it.
 */
export function AdSummaryRow({
  ad,
  index,
  onClick,
  onRemove,
  onClone,
  dragProps,
  isDragging,
  isDropTarget,
  dropEdge,
  isSelected,
  onSelectToggle,
  showCreativeWorkflow = true,
}: {
  ad: PacerAd;
  index: number;
  onClick: () => void;
  onRemove: (id: string) => void;
  onClone: (id: string) => void;
  dragProps?: ReturnType<DragReorderApi['rowProps']>;
  isDragging?: boolean;
  isDropTarget?: boolean;
  dropEdge?: DropEdge | null;
  isSelected: boolean;
  onSelectToggle: () => void;
  // Meta shows Design + Approvals columns; Google hides them (its campaigns
  // have no creative-workflow). Must match the parent table's <th> set.
  showCreativeWorkflow?: boolean;
}) {
  const readOnly = usePacerReadOnly();
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

  return (
    <tr
      onClick={onClick}
      {...(dragProps && !readOnly ? dragProps : {})}
      style={{ boxShadow: dropShadow }}
      className={`group border-b border-[var(--border)] last:border-b-0 transition-colors hover:bg-[var(--muted)]/50 ${
        readOnly ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
      } ${isSelected ? 'bg-[var(--primary)]/8' : ''} ${
        isDragging ? 'bg-[var(--primary)]/10' : ''
      }`}
    >
      {/* Bulk-selection checkbox (clicking it stops the row's click-to-edit) */}
      <td
        className="w-9 pl-3 pr-1 py-2 align-middle"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          aria-label={`Select ${ad.name || 'Untitled Ad'}`}
          checked={isSelected}
          onChange={onSelectToggle}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-[var(--border)] bg-[var(--input)] text-[var(--primary)] cursor-pointer accent-[var(--primary)]"
        />
      </td>

      {/* Color + name (+ Google channel-type subline, like Meta leads with the
          ad name) */}
      <td className="px-3 py-2 align-middle min-w-[200px]">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-2 h-2 rounded-sm flex-shrink-0"
            style={{ background: AD_COLORS[index % AD_COLORS.length] }}
          />
          <div className="min-w-0">
            <span className="block text-sm font-semibold text-[var(--foreground)] truncate">
              {ad.name || 'Untitled Ad'}
            </span>
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

      {/* Status */}
      <td className="px-3 py-2 align-middle whitespace-nowrap">
        <AdStatusPill status={ad.adStatus} />
      </td>

      {/* Due date — user-set; muted dash when unset */}
      <td
        className="px-3 py-2 align-middle whitespace-nowrap text-xs"
        style={{ color: ad.dueDate ? 'var(--foreground)' : 'var(--muted-foreground)' }}
      >
        {fmtDate(ad.dueDate)}
      </td>

      {/* Budget tags — Google shows Daily/Total + the genuinely-shared badge. */}
      <td className="px-3 py-2 align-middle whitespace-nowrap">
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
      </td>

      {/* Allocation (+ Google daily-rate subline: monthly ÷ 30.4) */}
      <td
        className="px-3 py-2 align-middle text-xs font-semibold whitespace-nowrap"
        style={{
          color: sourceColor(ad.budgetSource),
        }}
      >
        {allocation != null ? fmt(allocation) : '—'}
        {gDailyRate != null && (
          <span className="block text-[10px] font-normal text-[var(--muted-foreground)]">
            {fmt(gDailyRate)}/day avg
          </span>
        )}
      </td>

      {/* Run dates (status-colored progress bar) + §5 Google delivery flags */}
      <td className="px-3 py-2 align-middle">
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
      </td>

      {showCreativeWorkflow && (
        <>
          {/* Design */}
          <td className="px-3 py-2 align-middle whitespace-nowrap">
            <DesignPill status={ad.designStatus} />
          </td>

          {/* Approvals */}
          <td className="px-3 py-2 align-middle whitespace-nowrap">
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
          </td>
        </>
      )}

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
