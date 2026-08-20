'use client';

// The band above the Contacts table that says WHY the list is shorter
// than the roster.
//
// The Contacts page can be narrowed two ways — by opening a saved
// segment ("View contacts" on a segment card) or by building an ad-hoc
// filter here — and both used to be invisible: the segment link was
// silently ignored and there was no ad-hoc filter at all. A filtered
// list that looks identical to an unfiltered one is the failure mode
// this bar exists to prevent, so it always names the rules in force and
// always offers a way back to everyone.

import {
  ArrowDownTrayIcon,
  BookmarkIcon,
  FunnelIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { describeDefinition } from '@/lib/segments/describe';
import type { FieldDefinition, FilterDefinition } from '@/lib/smart-list-types';

export interface ActiveContactFilter {
  /** A saved segment opened from the segments page… */
  segmentId?: string | null;
  /** …its name, once resolved. Undefined while still loading. */
  segmentName?: string | null;
  /** …or an ad-hoc definition built right here. Always present once the
   *  filter has resolved, including for saved segments, so the rules can
   *  be listed and edited without a second round trip. */
  definition: FilterDefinition | null;
}

interface ActiveFilterBarProps {
  filter: ActiveContactFilter;
  fields: FieldDefinition[];
  /** Contacts matching the filter AND the current text search. */
  matchCount: number;
  /** Contacts matching the filter alone, before the text search. */
  segmentTotal?: number;
  /** True when a text search is narrowing the view. Only affects wording:
   *  export takes the whole filter, not the searched subset, and that has
   *  to be said rather than discovered in the downloaded file. */
  searchActive?: boolean;
  loading: boolean;
  /** Rooftops whose copy of the filter could not be resolved, if any. */
  accountErrors?: Array<{ accountKey: string; error: string }>;
  exporting: boolean;
  onEdit: () => void;
  onClear: () => void;
  onExport: () => void;
  /** Absent for a saved segment — it is already saved. */
  onSaveAsSegment?: () => void;
}

export function ActiveFilterBar({
  filter,
  fields,
  matchCount,
  segmentTotal,
  searchActive,
  loading,
  accountErrors,
  exporting,
  onEdit,
  onClear,
  onExport,
  onSaveAsSegment,
}: ActiveFilterBarProps) {
  const groups = describeDefinition(filter.definition, fields);
  const title = filter.segmentId
    ? filter.segmentName || 'Segment'
    : 'Custom filter';

  // The search box narrows within the filter, so two numbers are two
  // different facts. Showing only the first would make a search look
  // like the segment had shrunk.
  const narrowed =
    typeof segmentTotal === 'number' && segmentTotal !== matchCount;

  return (
    <div className="mb-4 rounded-xl border border-[var(--primary)]/40 bg-[var(--primary)]/5 px-4 py-3">
      <div className="flex items-start gap-3 flex-wrap">
        <FunnelIcon className="w-5 h-5 text-[var(--primary)] flex-shrink-0 mt-0.5" />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-semibold">{title}</span>
            <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
              {loading
                ? 'Resolving…'
                : narrowed
                  ? `${matchCount.toLocaleString()} of ${segmentTotal!.toLocaleString()} shown`
                  : `${matchCount.toLocaleString()} contact${matchCount === 1 ? '' : 's'}`}
            </span>
          </div>

          {/* The rules themselves, not just their count. */}
          {groups.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              {groups.map((group, groupIndex) => (
                <div key={groupIndex} className="flex items-center gap-1.5 flex-wrap">
                  {groupIndex > 0 && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] px-1">
                      {filter.definition?.logic === 'OR' ? 'or' : 'and'}
                    </span>
                  )}
                  {group.conditions.map((text, conditionIndex) => (
                    <span key={conditionIndex} className="flex items-center gap-1.5">
                      {conditionIndex > 0 && (
                        <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                          {group.logic === 'OR' ? 'or' : 'and'}
                        </span>
                      )}
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] border border-[var(--border)] bg-[var(--card)]">
                        {text}
                      </span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}

          {accountErrors && accountErrors.length > 0 && (
            <p className="mt-2 text-[11px] text-amber-400">
              {accountErrors.length} account
              {accountErrors.length === 1 ? '' : 's'} could not be filtered and{' '}
              {accountErrors.length === 1 ? 'is' : 'are'} not represented above:{' '}
              {accountErrors.map((e) => e.accountKey).join(', ')}.
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 px-2.5 h-8 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/50 transition-colors"
          >
            <PencilSquareIcon className="w-3.5 h-3.5" />
            Edit filter
          </button>
          {onSaveAsSegment && (
            <button
              type="button"
              onClick={onSaveAsSegment}
              className="inline-flex items-center gap-1.5 px-2.5 h-8 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/50 transition-colors"
            >
              <BookmarkIcon className="w-3.5 h-3.5" />
              Save as segment
            </button>
          )}
          <button
            type="button"
            onClick={onExport}
            // Gated on the FILTER's size, not the searched view's: a
            // search that narrows to nothing must not disable exporting
            // the segment it was searching inside.
            disabled={exporting || loading || (segmentTotal ?? matchCount) === 0}
            title={
              searchActive && typeof segmentTotal === 'number'
                ? `Downloads all ${segmentTotal.toLocaleString()} contacts matching this filter — the search box does not narrow the export`
                : 'Download every contact matching this filter as CSV'
            }
            className="inline-flex items-center gap-1.5 px-2.5 h-8 text-xs rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <button
            type="button"
            onClick={onClear}
            title="Show all contacts again"
            className="inline-flex items-center gap-1 px-2.5 h-8 text-xs rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--sidebar-muted)] transition-colors"
          >
            <XMarkIcon className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
