'use client';

/**
 * Campaign labels — the row chips, the add-label popover, and the filter bar
 * (google-pacing-card spec §9). Shared by BOTH pacers: the allocator is
 * Google-only, but tagging a line and viewing it as a slice is the same job on
 * Meta, and two implementations would drift into two label vocabularies.
 *
 * All tag parsing goes through lib/ad-pacer/labels — these components never touch
 * the stored JSON directly.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronUpDownIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
  MAX_LABEL_LENGTH,
  collectLabels,
  countByLabel,
  labelColor,
  normalizeLabel,
  parseTags,
  sameLabel,
} from '@/lib/ad-pacer/labels';
import { Tooltip } from './Tooltip';

/**
 * Dropdown surface shared by the label picker and the view filter.
 *
 * Uses `--card-strong` (96% opaque) with a heavy blur rather than `.glass-modal`
 * (90%): these popovers open directly over a dense table, and at 90% the rows
 * underneath read straight through the list. Matches SearchableSelect's popover,
 * so every dropdown on the card is the same surface.
 */
const POPOVER_CLASS =
  'animate-dropdown-in rounded-lg border border-[var(--border)] bg-[var(--card-strong)] shadow-xl backdrop-blur-2xl backdrop-saturate-150';

/** One row inside a dropdown: color dot, label, optional count, check when on. */
function OptionRow({
  color,
  label,
  count,
  active,
  onClick,
}: {
  color?: string;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium transition-colors hover:bg-[var(--muted)] ${
        active ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'
      }`}
    >
      {color ? (
        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} />
      ) : (
        <span className="h-2 w-2 flex-shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && (
        <span className="tabular-nums text-[10px] text-[var(--muted-foreground)]">{count}</span>
      )}
      {active && <span className="text-[11px] leading-none">✓</span>}
    </button>
  );
}

/** One label chip. `onRemove` omitted = read-only (frozen month / overview). */
function Chip({
  label,
  color,
  onRemove,
}: {
  label: string;
  color: string;
  onRemove?: () => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: `${color}1f`, color }}
    >
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove label ${label}`}
          className="opacity-60 transition-opacity hover:opacity-100"
        >
          <XMarkIcon className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

/**
 * A line's labels plus the add control. `allLabels` is the account's label
 * vocabulary (so the popover offers what already exists instead of inviting a
 * near-duplicate), and `onChange` receives the full next tag list for this line.
 */
export function LabelChips({
  tags,
  allLabels,
  onChange,
  readOnly = false,
}: {
  tags: string | null | undefined;
  allLabels: readonly string[];
  onChange?: (nextTags: string[]) => void;
  readOnly?: boolean;
}) {
  const current = parseTags(tags);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on any click outside the popover. Cheap and predictable — the popover
  // is small and lives inside a scrolling table row.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const editable = !readOnly && !!onChange;

  const toggle = (label: string) => {
    if (!onChange) return;
    const normalized = normalizeLabel(label);
    if (!normalized) return;
    onChange(
      current.some((t) => sameLabel(t, normalized))
        ? current.filter((t) => !sameLabel(t, normalized))
        : [...current, normalized],
    );
  };

  const addDraft = () => {
    const normalized = normalizeLabel(draft);
    if (!normalized || !onChange) return;
    if (!current.some((t) => sameLabel(t, normalized))) onChange([...current, normalized]);
    setDraft('');
  };

  if (current.length === 0 && !editable) return null;

  return (
    <div ref={wrapRef} className="relative mt-1 flex flex-wrap items-center gap-1">
      {current.map((label) => (
        <Chip
          key={label}
          label={label}
          color={labelColor(label, allLabels)}
          onRemove={editable ? () => toggle(label) : undefined}
        />
      ))}
      {editable && (
        <Tooltip label="Add a label — group campaigns for a sales event or theme">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            aria-label="Add label"
            aria-expanded={open}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-dashed border-[var(--border)] text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
          >
            <PlusIcon className="h-2.5 w-2.5" />
          </button>
        </Tooltip>
      )}
      {open && editable && (
        <div
          className={`${POPOVER_CLASS} absolute left-0 top-full z-40 mt-1.5 w-56 p-2`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Labels
          </div>
          {allLabels.length === 0 ? (
            <div className="px-1 pb-1 text-[11px] text-[var(--muted-foreground)]">
              No labels yet
            </div>
          ) : (
            <div className="max-h-44 overflow-y-auto">
              {allLabels.map((label) => (
                <OptionRow
                  key={label}
                  color={labelColor(label, allLabels)}
                  label={label}
                  active={current.some((t) => sameLabel(t, label))}
                  onClick={() => toggle(label)}
                />
              ))}
            </div>
          )}
          <div className="mt-1.5 flex gap-1.5 border-t border-[var(--border)] pt-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addDraft();
                }
              }}
              placeholder="New label…"
              maxLength={MAX_LABEL_LENGTH}
              aria-label="New label name"
              className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--input)] px-1.5 py-1 text-[11px] text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
            />
            <button
              type="button"
              onClick={addDraft}
              disabled={!normalizeLabel(draft)}
              className="rounded bg-[var(--primary)] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "All campaigns" plus one chip per known label. Selecting a label filters the
 * table AND rescopes every summary number to that subset (§9) — the caller owns
 * the rescoping; this is just the control.
 *
 * Renders nothing when the account has no labels: an empty filter bar is pure
 * chrome on the majority of accounts that never run a tagged event.
 */
export function LabelFilterBar({
  ads,
  activeLabel,
  onChange,
  /** Spacing override. Defaults to a standalone bar's own bottom margin (Meta
   *  renders it directly above its cards); Google's card nests it in a controls
   *  row that already carries the spacing, so it passes `mb-0`. */
  className = 'mb-3',
}: {
  ads: readonly { pacerTags?: string | null }[];
  activeLabel: string | null;
  onChange: (label: string | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const labels = collectLabels(ads);
  if (labels.length === 0) return null;
  const counts = countByLabel(ads);
  const activeColor = activeLabel ? labelColor(activeLabel, labels) : null;

  const pick = (label: string | null) => {
    onChange(label);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className={`relative flex items-center gap-2 ${className}`}>
      {/* No "View" label — the trigger reads "All campaigns" or the active
          label, which says what it is without one. */}
      {/* A dropdown rather than a chip per label: an account can accumulate a
          dozen events over a season, and a row of pills that wraps to two lines
          pushes the table down without telling you anything you can't read from
          the one active view. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex min-w-[10rem] items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-xs text-[var(--foreground)] transition-colors hover:border-[var(--primary)] focus:border-[var(--primary)] focus:outline-none"
      >
        {activeColor && (
          <span
            className="h-2 w-2 flex-shrink-0 rounded-full"
            style={{ background: activeColor }}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-left">
          {activeLabel ?? 'All campaigns'}
        </span>
        {activeLabel && (
          <span className="tabular-nums text-[10px] text-[var(--muted-foreground)]">
            {counts.get(activeLabel) ?? 0}
          </span>
        )}
        <ChevronUpDownIcon className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted-foreground)]" />
      </button>

      {open && (
        <div
          // Right-aligned to the trigger. `left-10` was a fixed 40px inset that
          // matched nothing: on a 10rem-wide field the panel started a third of
          // the way across it and overhung the right edge.
          className={`${POPOVER_CLASS} absolute right-0 top-full z-40 mt-1.5 w-56 p-2`}
          role="listbox"
        >
          <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            View
          </div>
          <OptionRow
            label="All campaigns"
            count={ads.length}
            active={activeLabel === null}
            onClick={() => pick(null)}
          />
          <div className="my-1 h-px bg-[var(--border)]" />
          <div className="max-h-56 overflow-y-auto">
            {labels.map((label) => (
              <OptionRow
                key={label}
                color={labelColor(label, labels)}
                label={label}
                count={counts.get(label) ?? 0}
                active={activeLabel != null && sameLabel(activeLabel, label)}
                onClick={() =>
                  pick(activeLabel != null && sameLabel(activeLabel, label) ? null : label)
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
