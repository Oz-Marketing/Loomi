'use client';

/**
 * Shared template-taxonomy controls — the Category + Tags UI used by every
 * template kind (email, ads, forms, landing pages) on the /templates page.
 *
 * Lifted verbatim from the email templates view so all kinds share one look +
 * behavior: a tag chip, a tag add/remove popover (tri-state for multi-target),
 * and a category select/create/clear popover. They operate on plain strings, so
 * each surface supplies its own read/write adapter.
 */
import { useMemo, useState } from 'react';
import { XMarkIcon, CheckIcon, PlusIcon } from '@heroicons/react/24/outline';
import { getTagColor } from '@/lib/tag-colors';

export function TagChip({
  tag,
  removable,
  onRemove,
  size = 'sm',
}: {
  tag: string;
  removable?: boolean;
  onRemove?: () => void;
  size?: 'xs' | 'sm';
}) {
  const color = getTagColor(tag);
  const px = size === 'xs' ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-[11px]';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full ${px} ${color.className}`}>
      {tag}
      {removable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className="opacity-60 hover:opacity-100 transition-opacity"
          aria-label={`Remove tag ${tag}`}
        >
          <XMarkIcon className="w-2.5 h-2.5" />
        </button>
      )}
    </span>
  );
}

/**
 * Popover for adding/removing tags on one or many templates.
 * Multi-target tags show a tri-state (some-have / none-have / all-have).
 */
export function TagEditorPopover({
  allTags,
  currentTags,
  onToggle,
  onCreate,
  align = 'left',
  popoverRef,
}: {
  allTags: string[];
  /** Map of tag -> 'all' | 'some' | 'none' across the affected templates. */
  currentTags: Record<string, 'all' | 'some' | 'none'>;
  onToggle: (tag: string, currentState: 'all' | 'some' | 'none') => void;
  onCreate: (tag: string) => Promise<void> | void;
  align?: 'left' | 'right';
  popoverRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () => allTags.filter((t) => t.toLowerCase().includes(query.toLowerCase())),
    [allTags, query],
  );
  const showCreate =
    query.trim().length > 0 &&
    !allTags.some((t) => t.toLowerCase() === query.trim().toLowerCase());

  return (
    <div
      ref={popoverRef}
      onClick={(e) => e.stopPropagation()}
      className={`absolute z-40 ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 w-56 glass-dropdown`}
    >
      <div className="p-2 border-b border-[var(--border)]">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && showCreate) {
              await onCreate(query.trim());
              setQuery('');
            }
          }}
          placeholder="Search or create…"
          autoFocus
          className="w-full text-xs bg-[var(--input)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
        />
      </div>
      <div className="p-1 max-h-56 overflow-y-auto">
        {filtered.map((tag) => {
          const state = currentTags[tag] || 'none';
          const color = getTagColor(tag);
          return (
            <button
              key={tag}
              onClick={() => onToggle(tag, state)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-md hover:bg-[var(--muted)] transition-colors text-left"
            >
              <span className="flex items-center gap-1 w-4 justify-center">
                {state === 'all' && <CheckIcon className="w-3.5 h-3.5 text-[var(--primary)]" />}
                {state === 'some' && <span className="w-2 h-0.5 bg-[var(--primary)] rounded" />}
              </span>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${color.className.split(' ')[0]}`} />
              <span className="flex-1 truncate">{tag}</span>
            </button>
          );
        })}
        {filtered.length === 0 && !showCreate && (
          <p className="px-2 py-2 text-[11px] text-[var(--muted-foreground)]">No tags match.</p>
        )}
        {showCreate && (
          <button
            onClick={async () => {
              await onCreate(query.trim());
              setQuery('');
            }}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-md hover:bg-[var(--muted)] transition-colors text-left text-[var(--primary)]"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            <span>Create &ldquo;{query.trim()}&rdquo;</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function CategoryEditorPopover({
  allCategories,
  current,
  onSelect,
  onClear,
  onCreate,
  align = 'left',
  popoverRef,
}: {
  allCategories: string[];
  current: string | null | undefined;
  onSelect: (cat: string) => void;
  onClear: () => void;
  onCreate: (cat: string) => void;
  align?: 'left' | 'right';
  popoverRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase().replace(/\s+/g, '-');
  const filtered = useMemo(
    () => allCategories.filter((c) => c.toLowerCase().includes(query.toLowerCase())),
    [allCategories, query],
  );
  const showCreate = normalized.length > 0 && !allCategories.includes(normalized);

  return (
    <div
      ref={popoverRef}
      onClick={(e) => e.stopPropagation()}
      className={`absolute z-40 ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 w-52 glass-dropdown`}
    >
      <div className="p-2 border-b border-[var(--border)]">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && showCreate) {
              onCreate(normalized);
            }
          }}
          placeholder="Search or create…"
          autoFocus
          className="w-full text-xs bg-[var(--input)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
        />
      </div>
      <div className="p-1 max-h-56 overflow-y-auto">
        {current && (
          <button
            onClick={onClear}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-md hover:bg-[var(--muted)] transition-colors text-left text-[var(--muted-foreground)]"
          >
            <XMarkIcon className="w-3.5 h-3.5" />
            Clear category
          </button>
        )}
        {filtered.map((cat) => (
          <button
            key={cat}
            onClick={() => onSelect(cat)}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-md hover:bg-[var(--muted)] transition-colors text-left"
          >
            <span className="w-4 flex justify-center">
              {current === cat && <CheckIcon className="w-3.5 h-3.5 text-[var(--primary)]" />}
            </span>
            <span className="capitalize">{cat.replace(/-/g, ' ')}</span>
          </button>
        ))}
        {filtered.length === 0 && !showCreate && (
          <p className="px-2 py-2 text-[11px] text-[var(--muted-foreground)]">No categories match.</p>
        )}
        {showCreate && (
          <button
            onClick={() => onCreate(normalized)}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-md hover:bg-[var(--muted)] transition-colors text-left text-[var(--primary)]"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            <span>Create &ldquo;{normalized}&rdquo;</span>
          </button>
        )}
      </div>
    </div>
  );
}
