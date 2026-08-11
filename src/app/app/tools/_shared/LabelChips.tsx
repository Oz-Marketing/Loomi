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
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
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
          className="glass-modal absolute left-0 top-full z-40 mt-1.5 w-56 rounded-lg border border-[var(--border)] p-2"
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
              {allLabels.map((label) => {
                const on = current.some((t) => sameLabel(t, label));
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggle(label)}
                    className={`flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-[11px] font-medium transition-colors hover:bg-[var(--muted)] ${
                      on ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'
                    }`}
                  >
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-sm"
                      style={{ background: labelColor(label, allLabels) }}
                    />
                    <span className="truncate">{label}</span>
                    {on && <span className="ml-auto text-[10px]">✓</span>}
                  </button>
                );
              })}
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
  const labels = collectLabels(ads);
  if (labels.length === 0) return null;
  const counts = countByLabel(ads);

  // Active chips take their color from inline style (the label's own color, or
  // the foreground for "All"), so the class only carries the shared shape.
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
      active
        ? 'border-transparent text-white'
        : 'border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:border-[var(--primary)]'
    }`;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        View
      </span>
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={activeLabel === null}
        className={chip(activeLabel === null)}
        style={
          activeLabel === null
            ? { background: 'var(--primary)', borderColor: 'var(--primary)' }
            : undefined
        }
      >
        All campaigns
      </button>
      {labels.map((label) => {
        const active = activeLabel != null && sameLabel(activeLabel, label);
        const color = labelColor(label, labels);
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(active ? null : label)}
            aria-pressed={active}
            className={chip(active)}
            style={active ? { background: color, borderColor: color } : undefined}
          >
            {!active && (
              <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
            )}
            {label}
            <span className="tabular-nums opacity-70">{counts.get(label) ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}
