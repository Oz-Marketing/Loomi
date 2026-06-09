'use client';

import { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

// Slot for header-area actions on the embedded templates view (when
// the parent owns the page title + tabs). ManagementView portals its
// Create Template + overflow menu into here so the affordances sit
// in the page header rather than below the tabs.
export const TemplatesHeaderActionsContext = createContext<HTMLElement | null>(null);
import { useRouter, useSearchParams } from 'next/navigation';
import {
  PlusIcon,
  XMarkIcon,
  BookOpenIcon,
  TrashIcon,
  EllipsisVerticalIcon,
  TagIcon,
  Square2StackIcon,
  PencilIcon,
  ArrowPathIcon,
  CursorArrowRaysIcon,
  CodeBracketIcon,
  MagnifyingGlassIcon,
  EyeIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  FunnelIcon,
  ChevronDownIcon,
  CheckIcon,
  FolderIcon,
  EllipsisHorizontalIcon,
} from '@heroicons/react/24/outline';
import { getTagColor } from '@/lib/tag-colors';
import BulkActionDock, { type BulkActionDockItem } from '@/components/bulk-action-dock';
import { toast } from '@/lib/toast';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { TemplatePreview } from '@/components/template-preview';
import {
  parseTemplateTagsPayload,
  assignmentsMapToArray,
} from '@/lib/template-tags-payload';
import PrimaryButton from '@/components/primary-button';

// ── Types ──

interface TemplateEntry {
  design: string;
  accountKey?: string | null;
  name: string;
  editorType?: 'code' | 'visual' | string | null;
  category?: string | null;
  updatedAt?: string;
  createdBy?: string | null;
  createdByAvatar?: string | null;
  updatedBy?: string | null;
  updatedByAvatar?: string | null;
  published?: boolean;
  publishedAt?: string | null;
  publishedBy?: string | null;
}

type TypeFilter = 'all' | 'visual' | 'code';
type TagMatchMode = 'any' | 'all';

type PublishFilter = 'all' | 'published' | 'draft';

interface TagData {
  tags: string[];
  assignments: Record<string, string[]>;
}

// ── Helpers ──

function formatDesign(d: string) {
  return d
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getLibraryTemplateTypeLabel(template: Pick<TemplateEntry, 'editorType'>): 'HTML' | 'Drag & Drop' {
  return template.editorType === 'visual' ? 'Drag & Drop' : 'HTML';
}

function buildLibraryEditorHref(
  template: Pick<TemplateEntry, 'design' | 'editorType'> | string,
  options?: { campaignDraft?: boolean; editorType?: TemplateEntry['editorType'] },
): string {
  const design = typeof template === 'string' ? template : template.design;
  const editorType = typeof template === 'string' ? options?.editorType : template.editorType;
  const search = new URLSearchParams({ design });
  if (editorType === 'code') {
    search.set('builder', 'html');
  }
  if (options?.campaignDraft) {
    search.set('campaignDraft', '1');
  }
  return `/templates/editor?${search.toString()}`;
}

function sanitizeFileName(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const safe = trimmed
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return safe || 'template';
}

function updateLibraryTemplateTitle(raw: string, title: string): string {
  const nextTitle = JSON.stringify(title.trim());
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);

  if (!frontmatterMatch) {
    return `---\ntitle: ${nextTitle}\n---\n\n${raw}`;
  }

  const existingFrontmatter = frontmatterMatch[1];
  const hasTitle = /^title:\s*.*$/m.test(existingFrontmatter);
  const updatedFrontmatter = hasTitle
    ? existingFrontmatter.replace(/^title:\s*.*$/m, `title: ${nextTitle}`)
    : `title: ${nextTitle}\n${existingFrontmatter}`;
  const rest = raw.slice(frontmatterMatch[0].length);

  return `---\n${updatedFrontmatter}\n---\n${rest}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadLibraryTemplateScreenshot(
  design: string,
  fileBaseName: string,
): Promise<void> {
  const params = new URLSearchParams({ design });
  const res = await fetch(`/api/templates/screenshot?${params.toString()}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : `Screenshot failed (${res.status})`,
    );
  }

  const blob = await res.blob();
  if (!blob || blob.size === 0) {
    throw new Error('Screenshot returned empty data');
  }

  downloadBlob(blob, `${sanitizeFileName(fileBaseName)}.png`);
}

function openLibraryPreviewInNewTab(design: string): void {
  const url = `/api/preview?design=${encodeURIComponent(design)}&format=html`;
  const win = window.open(url, '_blank');
  if (!win) {
    toast.error('Unable to open a new tab. Please allow pop-ups.');
    return;
  }
  try {
    win.opener = null;
  } catch {
    // Ignore browser restrictions around opener.
  }
}

// ═══════════════════════════════════════════════════════════════════
// ── Filter UI primitives ──
// ═══════════════════════════════════════════════════════════════════

interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  count?: number;
}

function SegmentedPicker<V extends string>({
  value,
  onChange,
  options,
}: {
  value: V;
  onChange: (v: V) => void;
  options: SegmentedOption<V>[];
}) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`text-xs px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
            value === opt.value
              ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm'
              : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
          }`}
        >
          {opt.label}
          {typeof opt.count === 'number' && (
            <span className="tabular-nums text-[10px] opacity-70 ml-1">{opt.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function FilterDropdown({
  label,
  icon,
  open,
  onOpenChange,
  popoverRef,
  badgeCount,
  width = 200,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  popoverRef?: React.RefObject<HTMLDivElement | null>;
  badgeCount?: number;
  width?: number;
  children: React.ReactNode;
}) {
  const hasSelection = (badgeCount ?? 0) > 0;
  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => onOpenChange(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
          hasSelection
            ? 'border-[var(--primary)]/40 text-[var(--primary)] bg-[var(--primary)]/5'
            : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
        }`}
      >
        {icon}
        {label}
        {hasSelection && (
          <span className="tabular-nums text-[10px] bg-[var(--primary)]/15 text-[var(--primary)] rounded-full px-1.5">
            {badgeCount}
          </span>
        )}
        <ChevronDownIcon className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-30 glass-dropdown"
          style={{ width }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Body of the unified Filter ▾ popover. Holds Type segmented, Category list,
 * and Tags list (with Untagged + Match-any/all). Shared by both the management
 * and read-only library views.
 */
function FilterMenuContent({
  typeFilter,
  setTypeFilter,
  allCategories,
  selectedCategories,
  setSelectedCategories,
  tags,
  assignments,
  selectedTags,
  setSelectedTags,
  tagMatchMode,
  setTagMatchMode,
  untaggedOnly,
  setUntaggedOnly,
  toggleSetMember,
}: {
  typeFilter: TypeFilter;
  setTypeFilter: (v: TypeFilter) => void;
  allCategories: string[];
  selectedCategories: Set<string>;
  setSelectedCategories: (next: Set<string>) => void;
  tags: string[];
  assignments: Record<string, string[]>;
  selectedTags: Set<string>;
  setSelectedTags: (next: Set<string>) => void;
  tagMatchMode: TagMatchMode;
  setTagMatchMode: (m: TagMatchMode) => void;
  untaggedOnly?: boolean;
  setUntaggedOnly?: (v: boolean) => void;
  toggleSetMember: <T extends string>(set: Set<T>, value: T) => Set<T>;
}) {
  return (
    <div className="py-1.5">
      {/* Type */}
      <div className="px-2.5 pt-1.5 pb-1">
        <p className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">Type</p>
        <div className="flex items-center gap-0.5 p-0.5 rounded-md border border-[var(--border)] bg-[var(--muted)]/40">
          {(
            [
              { value: 'all' as TypeFilter, label: 'Any' },
              { value: 'visual' as TypeFilter, label: 'Drag & Drop' },
              { value: 'code' as TypeFilter, label: 'HTML' },
            ]
          ).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTypeFilter(opt.value)}
              className={`flex-1 text-[11px] px-2 py-0.5 rounded transition-colors ${
                typeFilter === opt.value
                  ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Category */}
      {allCategories.length > 0 && (
        <div className="px-2.5 pt-3 pb-1">
          <p className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5">Category</p>
          <div className="max-h-44 overflow-y-auto -mx-1 px-1">
            {allCategories.map((cat) => {
              const active = selectedCategories.has(cat);
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategories(toggleSetMember(selectedCategories, cat))}
                  className={`w-full flex items-center justify-between gap-2 px-2 py-1 text-xs rounded-md transition-colors ${
                    active ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                  }`}
                >
                  <span className="capitalize truncate">{cat.replace(/-/g, ' ')}</span>
                  {active && <CheckIcon className="w-3.5 h-3.5 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="px-2.5 pt-3 pb-2">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">Tags</p>
            {!untaggedOnly && selectedTags.size > 1 && (
              <div className="flex items-center gap-0.5 p-0.5 rounded border border-[var(--border)] bg-[var(--muted)]/40">
                {(['any', 'all'] as TagMatchMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setTagMatchMode(m)}
                    className={`text-[10px] px-1.5 py-px rounded transition-colors ${
                      tagMatchMode === m ? 'bg-[var(--card)] text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'
                    }`}
                  >
                    {m === 'any' ? 'Any' : 'All'}
                  </button>
                ))}
              </div>
            )}
          </div>
          {setUntaggedOnly && (
            <button
              onClick={() => { setUntaggedOnly(!untaggedOnly); if (!untaggedOnly) setSelectedTags(new Set()); }}
              className={`w-full flex items-center justify-between gap-2 px-2 py-1 text-xs rounded-md transition-colors mb-0.5 ${
                untaggedOnly ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              <span className="italic">Untagged only</span>
              {untaggedOnly && <CheckIcon className="w-3.5 h-3.5 flex-shrink-0" />}
            </button>
          )}
          <div className="max-h-44 overflow-y-auto -mx-1 px-1">
            {tags.map((tag) => {
              const active = selectedTags.has(tag);
              const color = getTagColor(tag);
              const count = Object.values(assignments).filter((ts) => ts.includes(tag)).length;
              return (
                <button
                  key={tag}
                  disabled={untaggedOnly}
                  onClick={() => setSelectedTags(toggleSetMember(selectedTags, tag))}
                  className={`w-full flex items-center justify-between gap-2 px-2 py-1 text-xs rounded-md transition-colors ${
                    active ? 'bg-[var(--primary)]/10' : 'hover:bg-[var(--muted)]'
                  } ${untaggedOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${color.className.split(' ')[0]}`} />
                    <span className="truncate">{tag}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                    <span className="tabular-nums text-[10px]">{count}</span>
                    {active && <CheckIcon className="w-3.5 h-3.5 text-[var(--primary)]" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {allCategories.length === 0 && tags.length === 0 && (
        <p className="px-3 py-3 text-[11px] text-[var(--muted-foreground)] italic text-center">
          No categories or tags yet. Add them inline from a template card.
        </p>
      )}
    </div>
  );
}

function ActiveFilterChip({
  label,
  prefix,
  colorClass,
  onRemove,
}: {
  label: string;
  prefix?: string;
  colorClass?: string;
  onRemove: () => void;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] ${
        colorClass ?? 'bg-[var(--muted)] text-[var(--foreground)]'
      }`}
    >
      {prefix && <span className="opacity-60">{prefix}</span>}
      <span className="capitalize truncate max-w-[160px]">{label}</span>
      <button
        onClick={onRemove}
        className="opacity-60 hover:opacity-100 transition-opacity"
        aria-label={`Remove filter ${label}`}
      >
        <XMarkIcon className="w-3 h-3" />
      </button>
    </span>
  );
}

function TagChip({
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
function TagEditorPopover({
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

function CategoryEditorPopover({
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

// ═══════════════════════════════════════════════════════════════════
// ── Main Page ──
// ═══════════════════════════════════════════════════════════════════

export default function TemplateLibraryPage() {
  const searchParams = useSearchParams();
  const { userRole, account, accountKey, accountData } = useAccount();
  const campaignDraftQuery = searchParams.get('campaignDraft') === '1' ? '?campaignDraft=1' : '';

  const isClient = userRole === 'client';
  // developer, super_admin, and admin all get full management access to the library.
  const canManage = userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin';

  // When viewing inside a subaccount, swap to the tabbed view that separates
  // "Subaccount Templates" (owned by this subaccount) from the shared
  // "Template Library".
  if (account.mode === 'account' && accountKey) {
    return (
      <SubaccountTabsView
        accountKey={accountKey}
        accountLabel={accountData?.dealer ?? accountKey}
        canManage={canManage}
        isClient={isClient}
        campaignDraftQuery={campaignDraftQuery}
      />
    );
  }

  return (
    <div>
      {canManage && <ManagementView campaignDraftQuery={campaignDraftQuery} />}
      {isClient && <ReadOnlyView campaignDraftQuery={campaignDraftQuery} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ── Subaccount Tabs View ──
// ═══════════════════════════════════════════════════════════════════

/**
 * Shell for the templates page when viewing inside a subaccount. Renders the
 * sticky title + tab switcher and swaps between the subaccount-scoped view
 * and the shared library (read-only published templates) below.
 */
function SubaccountTabsView({
  accountKey,
  accountLabel,
  canManage,
  isClient,
  campaignDraftQuery,
}: {
  accountKey: string;
  accountLabel: string;
  canManage: boolean;
  isClient: boolean;
  campaignDraftQuery: string;
}) {
  const [tab, setTab] = useState<'subaccount' | 'library'>('subaccount');
  // Force-remount the subaccount view when a library copy completes so the
  // freshly-cloned template appears immediately on tab switch.
  const [subaccountRefreshKey, setSubaccountRefreshKey] = useState(0);
  // Slot element for header-aligned action buttons. ManagementView
  // portals its Create + overflow buttons into this div via the
  // TemplatesHeaderActionsContext below.
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);

  const subaccountSubtitle = `Templates owned by ${accountLabel}.`;
  const librarySubtitle = 'Published templates from the shared library.';

  return (
    <TemplatesHeaderActionsContext.Provider value={actionsSlot}>
    <div>
      <div className="page-sticky-header mb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BookOpenIcon className="w-7 h-7 text-[var(--primary)] flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">Templates</h1>
              <p className="text-[var(--muted-foreground)] text-sm mt-0.5 truncate">
                {tab === 'subaccount' ? subaccountSubtitle : librarySubtitle}
              </p>
            </div>
          </div>
          {/* Right-aligned action slot. ManagementView's Create
              Template + overflow buttons portal in here when active. */}
          <div
            ref={setActionsSlot}
            className="flex items-center gap-2 flex-shrink-0"
          />
        </div>
        <div className="mt-4 flex items-center gap-1 border-b border-[var(--border)]">
          {([
            { id: 'subaccount' as const, label: 'Subaccount Templates' },
            { id: 'library' as const, label: 'Template Library' },
          ]).map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  active
                    ? 'border-[var(--primary)] text-[var(--foreground)]'
                    : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'subaccount' ? (
        canManage ? (
          <ManagementView
            key={`mgmt-${subaccountRefreshKey}`}
            campaignDraftQuery={campaignDraftQuery}
            accountKey={accountKey}
            embedded
          />
        ) : isClient ? (
          <ReadOnlyView
            key={`ro-${subaccountRefreshKey}`}
            campaignDraftQuery={campaignDraftQuery}
            accountKey={accountKey}
            embedded
          />
        ) : null
      ) : (
        <ReadOnlyView
          campaignDraftQuery={campaignDraftQuery}
          copyTargetAccountKey={accountKey}
          copyTargetAccountLabel={accountLabel}
          onCopyComplete={() => {
            setSubaccountRefreshKey((n) => n + 1);
            setTab('subaccount');
          }}
          embedded
        />
      )}
    </div>
    </TemplatesHeaderActionsContext.Provider>
  );
}

// Portals Create Template + overflow menu into the slot the parent
// SubaccountTabsView reserves in its sticky header. Renders nothing
// (returns null) until the slot DOM node is available on first
// render after mount.
function EmbeddedHeaderActions({
  showOverflowMenu,
  overflowMenuRef,
  onToggleOverflowMenu,
  onManageTags,
  onCreate,
}: {
  showOverflowMenu: boolean;
  overflowMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleOverflowMenu: () => void;
  onManageTags: () => void;
  onCreate: () => void;
}) {
  const slot = useContext(TemplatesHeaderActionsContext);
  if (!slot) return null;
  return createPortal(
    <>
      <div className="relative" ref={showOverflowMenu ? overflowMenuRef : undefined}>
        <button
          onClick={onToggleOverflowMenu}
          className="flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          title="More actions"
          aria-label="More actions"
        >
          <EllipsisHorizontalIcon className="w-4 h-4" />
        </button>
        {showOverflowMenu && (
          <div className="absolute right-0 top-full mt-1 z-30 w-48 glass-dropdown">
            <button
              onClick={onManageTags}
              className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2"
            >
              <TagIcon className="w-4 h-4" />
              Manage tags
            </button>
          </div>
        )}
      </div>
      <PrimaryButton onClick={onCreate}>
        <PlusIcon className="w-4 h-4" />
        Create Template
      </PrimaryButton>
    </>,
    slot,
  );
}

// ═══════════════════════════════════════════════════════════════════
// ── Email Templates Panel (reusable; used by the unified /templates) ──
// ═══════════════════════════════════════════════════════════════════

/**
 * Header-less email-templates surface for the Email tab of the unified
 * /templates page. Renders the management view (this account's own
 * templates) by default; when `libraryOpen` is set the parent swaps in the
 * read-only shared library (with copy-to-subaccount).
 *
 * The parent (unified shell) owns the sticky header — the "Browse Template
 * Library" toggle and the embedded ManagementView's Create + overflow
 * buttons both live up there. ManagementView portals its buttons into the
 * shell's TemplatesHeaderActionsContext slot, so this component renders just
 * the active view. Keyed by accountKey so a sub-account switch fully
 * remounts the view onto the new scope.
 */
export function EmailTemplatesPanel({
  campaignDraftQuery,
  accountKey,
  accountLabel,
  canManage,
  isClient,
  libraryOpen,
  refreshKey,
  onCopyComplete,
}: {
  campaignDraftQuery: string;
  accountKey?: string;
  accountLabel?: string;
  canManage: boolean;
  isClient: boolean;
  libraryOpen: boolean;
  refreshKey: number;
  onCopyComplete: () => void;
}) {
  if (libraryOpen) {
    return (
      <ReadOnlyView
        campaignDraftQuery={campaignDraftQuery}
        copyTargetAccountKey={accountKey}
        copyTargetAccountLabel={accountLabel}
        onCopyComplete={onCopyComplete}
        embedded
      />
    );
  }
  if (canManage) {
    return (
      <ManagementView
        key={`mgmt-${accountKey ?? 'admin'}-${refreshKey}`}
        campaignDraftQuery={campaignDraftQuery}
        accountKey={accountKey}
        embedded
      />
    );
  }
  if (isClient) {
    return (
      <ReadOnlyView
        key={`ro-${accountKey ?? 'admin'}-${refreshKey}`}
        campaignDraftQuery={campaignDraftQuery}
        accountKey={accountKey}
        embedded
      />
    );
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// ── Management View (full management — developer, super_admin, admin) ──
// ═══════════════════════════════════════════════════════════════════

function ManagementView({
  campaignDraftQuery,
  accountKey,
  embedded,
}: {
  campaignDraftQuery: string;
  // When set, scopes the view to this subaccount's templates (no publish UI).
  accountKey?: string;
  // When true, the parent renders the page header so this view hides its own.
  embedded?: boolean;
}) {
  const router = useRouter();
  const { confirm } = useLoomiDialog();
  const scoped = Boolean(accountKey);
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCreateChoice, setShowCreateChoice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [tagData, setTagData] = useState<TagData>({ tags: [], assignments: {} });
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [tagMatchMode, setTagMatchMode] = useState<TagMatchMode>('any');
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [showTagModal, setShowTagModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [previewDesign, setPreviewDesign] = useState<string | null>(null);
  const [selectedDesigns, setSelectedDesigns] = useState<Set<string>>(new Set());
  const [renameDesign, setRenameDesign] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [downloadingDesign, setDownloadingDesign] = useState<string | null>(null);
  const [publishFilter, setPublishFilter] = useState<PublishFilter>('all');
  const [publishingDesign, setPublishingDesign] = useState<string | null>(null);
  // Toolbar popover anchors
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  // Per-card popovers for inline editing
  const [editingTagsFor, setEditingTagsFor] = useState<string | null>(null);
  const [editingCategoryFor, setEditingCategoryFor] = useState<string | null>(null);
  // Bulk tag modal (opens from the bulk-action dock)
  const [bulkTagModalOpen, setBulkTagModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const filterPopoverRef = useRef<HTMLDivElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const cardPopoverRef = useRef<HTMLDivElement>(null);
  const isCampaignDraft = campaignDraftQuery.length > 0;

  const loadTemplates = async () => {
    try {
      const listUrl = accountKey
        ? `/api/templates?accountKey=${encodeURIComponent(accountKey)}`
        : '/api/templates';
      const [tRes, tagRes] = await Promise.all([
        fetch(listUrl),
        fetch('/api/template-tags'),
      ]);
      const tData = await tRes.json();
      const tagResult = await tagRes.json();
      setTemplates(Array.isArray(tData) ? tData : []);
      setTagData(parseTemplateTagsPayload(tagResult));
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  };

  // Refetch when the account scope changes — the unified /templates page
  // can mount this view before the sub-account context has resolved from
  // the URL, so the initial accountKey may be undefined and then settle.
  useEffect(() => { loadTemplates(); }, [accountKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  useEffect(() => {
    if (!showFilterMenu && !showOverflowMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showFilterMenu && !filterPopoverRef.current?.contains(target)) setShowFilterMenu(false);
      if (showOverflowMenu && !overflowMenuRef.current?.contains(target)) setShowOverflowMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showFilterMenu, showOverflowMenu]);

  useEffect(() => {
    if (!editingTagsFor && !editingCategoryFor) return;
    const handler = (e: MouseEvent) => {
      if (!cardPopoverRef.current?.contains(e.target as Node)) {
        setEditingTagsFor(null);
        setEditingCategoryFor(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editingTagsFor, editingCategoryFor]);

  const tplMap = useMemo(() => {
    const map: Record<string, TemplateEntry> = {};
    templates.forEach((t) => { map[t.design] = t; });
    return map;
  }, [templates]);

  const filtered = useMemo(() => {
    let list = templates;
    if (publishFilter === 'published') {
      list = list.filter((t) => t.published === true);
    } else if (publishFilter === 'draft') {
      list = list.filter((t) => t.published !== true);
    }
    if (typeFilter === 'visual') {
      list = list.filter((t) => t.editorType === 'visual');
    } else if (typeFilter === 'code') {
      list = list.filter((t) => t.editorType !== 'visual');
    }
    if (selectedCategories.size > 0) {
      list = list.filter((t) => t.category != null && selectedCategories.has(t.category));
    }
    if (untaggedOnly) {
      list = list.filter((t) => (tagData.assignments[t.design] || []).length === 0);
    } else if (selectedTags.size > 0) {
      list = list.filter((t) => {
        const tags = tagData.assignments[t.design] || [];
        if (tagMatchMode === 'all') {
          for (const wanted of selectedTags) if (!tags.includes(wanted)) return false;
          return true;
        }
        for (const tag of tags) if (selectedTags.has(tag)) return true;
        return false;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => {
        const tags = tagData.assignments[t.design] || [];
        return (
          t.name.toLowerCase().includes(q) ||
          t.design.toLowerCase().includes(q) ||
          (t.category != null && t.category.toLowerCase().includes(q)) ||
          tags.some((tag) => tag.toLowerCase().includes(q))
        );
      });
    }
    return list;
  }, [templates, publishFilter, typeFilter, selectedCategories, untaggedOnly, selectedTags, tagMatchMode, search, tagData]);

  const draftCount = useMemo(() => templates.filter((t) => t.published !== true).length, [templates]);
  const publishedCount = useMemo(() => templates.filter((t) => t.published === true).length, [templates]);

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const t of templates) if (t.category) set.add(t.category);
    return [...set].sort();
  }, [templates]);

  const activeFilterCount =
    (publishFilter !== 'all' ? 1 : 0) +
    (typeFilter !== 'all' ? 1 : 0) +
    selectedCategories.size +
    (untaggedOnly ? 1 : 0) +
    selectedTags.size +
    (search.trim() ? 1 : 0);

  const clearAllFilters = () => {
    setSearch('');
    setPublishFilter('all');
    setTypeFilter('all');
    setSelectedCategories(new Set());
    setSelectedTags(new Set());
    setUntaggedOnly(false);
    setTagMatchMode('any');
  };

  /** Count of filters that live inside the Filter ▾ popover (Type, Category, Tags, Untagged). */
  const filterMenuCount =
    (typeFilter !== 'all' ? 1 : 0) +
    selectedCategories.size +
    selectedTags.size +
    (untaggedOnly ? 1 : 0);

  const toggleSetMember = <T extends string>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  /**
   * Persist a new tag assignment for one template. Sends the full tag payload
   * (server is happy to receive it; the diff lives client-side).
   */
  const setTagsForTemplate = async (design: string, tags: string[]) => {
    const next: TagData = {
      tags: Array.from(new Set([...tagData.tags, ...tags])),
      assignments: { ...tagData.assignments, [design]: tags },
    };
    if (tags.length === 0) delete next.assignments[design];
    setTagData(next);
    try {
      await fetch('/api/template-tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: next.tags,
          assignments: assignmentsMapToArray(next.assignments),
        }),
      });
    } catch {
      toast.error('Failed to save tags');
      void loadTemplates();
    }
  };

  /** Apply (add or remove) a single tag across many templates. */
  const applyTagToTemplates = async (tag: string, designs: string[], action: 'add' | 'remove') => {
    const nextAssignments = { ...tagData.assignments };
    for (const design of designs) {
      const current = nextAssignments[design] || [];
      if (action === 'add' && !current.includes(tag)) {
        nextAssignments[design] = [...current, tag];
      } else if (action === 'remove' && current.includes(tag)) {
        const filtered = current.filter((t) => t !== tag);
        if (filtered.length === 0) delete nextAssignments[design];
        else nextAssignments[design] = filtered;
      }
    }
    const nextTags = action === 'add'
      ? Array.from(new Set([...tagData.tags, tag]))
      : tagData.tags;
    const next: TagData = { tags: nextTags, assignments: nextAssignments };
    setTagData(next);
    try {
      await fetch('/api/template-tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: next.tags,
          assignments: assignmentsMapToArray(next.assignments),
        }),
      });
      toast.success(`${action === 'add' ? 'Added' : 'Removed'} "${tag}" on ${designs.length} template${designs.length === 1 ? '' : 's'}`);
    } catch {
      toast.error('Failed to update tags');
      void loadTemplates();
    }
  };

  const setCategoryForTemplate = async (design: string, category: string | null) => {
    setTemplates((prev) => prev.map((t) => (t.design === design ? { ...t, category } : t)));
    try {
      const res = await fetch('/api/templates/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: design, category }),
      });
      if (!res.ok) throw new Error('Failed');
    } catch {
      toast.error('Failed to update category');
      void loadTemplates();
    }
  };

  // Pick a default name that won't collide with anything already in the
  // library. Walks "Untitled Template", "Untitled Template 2", etc. so
  // the rep lands in the editor with a clean default they can rename.
  const nextUntitledName = (): string => {
    const existing = new Set(
      templates.map((t) => (t.name || formatDesign(t.design)).trim().toLowerCase()),
    );
    if (!existing.has('untitled template')) return 'Untitled Template';
    for (let n = 2; n < 1000; n++) {
      const candidate = `Untitled Template ${n}`;
      if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    // Fallback — astronomically unlikely to land here, but keep the
    // function total.
    return `Untitled Template ${Date.now()}`;
  };

  const createTemplate = async (mode: 'visual' | 'code') => {
    if (saving) return;
    setSaving(true);
    const defaultName = nextUntitledName();
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          design: defaultName,
          mode,
          ...(accountKey ? { accountKey } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to create'); setSaving(false); return; }
      setShowCreateChoice(false);
      // No loadTemplates() here — we're navigating straight to the
      // editor, so refetching the list is wasted work.
      router.push(buildLibraryEditorHref(
        { design: data.design, editorType: mode },
        { campaignDraft: isCampaignDraft },
      ));
    } catch { toast.error('Failed to create'); }
    setSaving(false);
  };

  const deleteTemplate = async (design: string) => {
    const confirmed = await confirm({
      title: 'Delete Template',
      message: `Delete "${formatDesign(design)}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/templates?design=${encodeURIComponent(design)}`, { method: 'DELETE' });
      if (!res.ok) { toast.error('Failed to delete'); return; }
      toast.success('Template deleted');
      await loadTemplates();
    } catch { toast.error('Failed to delete'); }
  };

  const cloneTemplate = async (sourceDesign: string) => {
    try {
      const res = await fetch('/api/templates/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceDesign }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to clone'); return; }
      toast.success(`Cloned as "${data.name}"`);
      await loadTemplates();
    } catch { toast.error('Failed to clone'); }
  };

  const setPublishedState = async (designs: string[], published: boolean) => {
    if (designs.length === 0) return;
    const single = designs.length === 1 ? designs[0] : null;
    if (single) setPublishingDesign(single);
    try {
      const res = await fetch('/api/templates/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs: designs, published }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to update publish state');
        return;
      }
      // Optimistic update so the pill flips immediately without a full reload.
      setTemplates((prev) =>
        prev.map((t) =>
          designs.includes(t.design) ? { ...t, published } : t,
        ),
      );
      const count = designs.length;
      const label = published ? 'Published' : 'Unpublished';
      toast.success(`${label} ${count} template${count === 1 ? '' : 's'}`);
    } catch {
      toast.error('Failed to update publish state');
    } finally {
      if (single) setPublishingDesign(null);
    }
  };

  const openRenameModal = (template: TemplateEntry) => {
    setRenameDesign(template.design);
    setRenameValue(template.name || formatDesign(template.design));
  };

  const closeRenameModal = () => {
    if (renaming) return;
    setRenameDesign(null);
    setRenameValue('');
  };

  const handleRenameTemplate = async () => {
    if (!renameDesign) return;
    const nextName = renameValue.trim();
    if (!nextName) {
      toast.error('Template name is required');
      return;
    }

    const currentName = tplMap[renameDesign]?.name || formatDesign(renameDesign);
    if (nextName === currentName.trim()) {
      closeRenameModal();
      return;
    }

    setRenaming(true);
    try {
      const rawRes = await fetch(`/api/templates?design=${encodeURIComponent(renameDesign)}&format=raw`);
      const rawData = await rawRes.json().catch(() => ({}));
      if (!rawRes.ok || typeof rawData?.raw !== 'string') {
        const message = typeof rawData?.error === 'string' ? rawData.error : 'Failed to load template';
        toast.error(message);
        return;
      }

      const updatedRaw = updateLibraryTemplateTitle(rawData.raw, nextName);
      const saveRes = await fetch('/api/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          design: renameDesign,
          raw: updatedRaw,
        }),
      });
      const saveData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        const message = typeof saveData?.error === 'string' ? saveData.error : 'Failed to rename template';
        toast.error(message);
        return;
      }

      toast.success('Template renamed');
      closeRenameModal();
      await loadTemplates();
    } catch {
      toast.error('Failed to rename template');
    } finally {
      setRenaming(false);
    }
  };

  const handleToggleSelect = (design: string) => {
    setSelectedDesigns((prev) => {
      const next = new Set(prev);
      if (next.has(design)) next.delete(design);
      else next.add(design);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedDesigns.size === 0) return;
    // Show the names of the templates that will be deleted (capped at 8 lines).
    // The previous count-only message let users miss when the selection had
    // unintentionally accumulated rows from a prior Move action — names make
    // over-selection obvious before the user clicks through.
    const nameByDesign = new Map(
      templates.map((t) => [t.design, t.name || formatDesign(t.design) || 'Untitled']),
    );
    const selectedNames = Array.from(selectedDesigns).map(
      (design) => nameByDesign.get(design) || 'Unknown template',
    );
    const previewLimit = 8;
    const shown = selectedNames.slice(0, previewLimit).map((n) => `• ${n}`).join('\n');
    const remaining = selectedNames.length - previewLimit;
    const list = remaining > 0 ? `${shown}\n… and ${remaining} more` : shown;
    const count = selectedDesigns.size;
    const headline = `Delete ${count} template${count !== 1 ? 's' : ''}?`;
    const confirmed = await confirm({
      title: 'Delete Templates',
      message: `${headline}\n\n${list}\n\nThis cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    const results = await Promise.allSettled(
      Array.from(selectedDesigns).map((design) =>
        fetch(`/api/templates?design=${encodeURIComponent(design)}`, { method: 'DELETE' }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    if (failed > 0) {
      toast.error(`Deleted ${succeeded}, failed ${failed}`);
    } else {
      toast.success(`Deleted ${succeeded} template${succeeded !== 1 ? 's' : ''}`);
    }

    setSelectedDesigns(new Set());
    await loadTemplates();
  };

  const saveTagData = async (data: TagData) => {
    try {
      await fetch('/api/template-tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: data.tags,
          assignments: assignmentsMapToArray(data.assignments),
        }),
      });
      setTagData(data);
      setShowTagModal(false);
      toast.success('Tags saved');
    } catch { toast.error('Failed to save tags'); }
  };

  const handleDownloadScreenshot = async (template: TemplateEntry) => {
    setDownloadingDesign(template.design);
    try {
      await downloadLibraryTemplateScreenshot(
        template.design,
        template.name || formatDesign(template.design),
      );
      toast.success('Template screenshot downloaded');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to download screenshot';
      toast.error(message);
    } finally {
      setDownloadingDesign((prev) => (prev === template.design ? null : prev));
    }
  };

  if (!loaded) {
    return <div className="text-[var(--muted-foreground)]">Loading...</div>;
  }

  return (
    <div>
      {/* Sticky header — page title + primary actions. Hidden when embedded
          (parent component already renders a header above tabs). */}
      {!embedded && (
        <div className="page-sticky-header mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BookOpenIcon className="w-7 h-7 text-[var(--primary)] flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">Templates</h1>
              <p className="text-[var(--muted-foreground)] text-sm mt-0.5 truncate">
                Shared template library. Publish templates to make them available to sub-accounts.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="relative" ref={showOverflowMenu ? overflowMenuRef : undefined}>
              <button
                onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                className="flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                title="More actions"
                aria-label="More actions"
              >
                <EllipsisHorizontalIcon className="w-4 h-4" />
              </button>
              {showOverflowMenu && (
                <div className="absolute right-0 top-full mt-1 z-30 w-48 glass-dropdown">
                  <button
                    onClick={() => { setShowTagModal(true); setShowOverflowMenu(false); }}
                    className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2"
                  >
                    <TagIcon className="w-4 h-4" />
                    Manage tags
                  </button>
                </div>
              )}
            </div>
            <PrimaryButton onClick={() => setShowCreateChoice(true)}>
              <PlusIcon className="w-4 h-4" />
              Create Template
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Embedded actions — when the parent owns the header, portal
          the Create + overflow buttons into the header's right-side
          slot via TemplatesHeaderActionsContext. The buttons sit next
          to the page title instead of below the tabs. */}
      {embedded && (
        <EmbeddedHeaderActions
          showOverflowMenu={showOverflowMenu}
          overflowMenuRef={overflowMenuRef}
          onToggleOverflowMenu={() => setShowOverflowMenu(!showOverflowMenu)}
          onManageTags={() => { setShowTagModal(true); setShowOverflowMenu(false); }}
          onCreate={() => setShowCreateChoice(true)}
        />
      )}

      {/* Toolbar */}
      <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
              <div className="relative flex-1 min-w-[180px] max-w-xs">
                <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, tag, category…"
                  className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
                />
              </div>

              {!scoped && (
                <SegmentedPicker
                  value={publishFilter}
                  onChange={setPublishFilter}
                  options={[
                    { value: 'all', label: 'All', count: templates.length },
                    { value: 'published', label: 'Published', count: publishedCount },
                    { value: 'draft', label: 'Drafts', count: draftCount },
                  ]}
                />
              )}

              <FilterDropdown
                label="Filter"
                icon={<FunnelIcon className="w-3.5 h-3.5" />}
                open={showFilterMenu}
                onOpenChange={setShowFilterMenu}
                popoverRef={showFilterMenu ? filterPopoverRef : undefined}
                badgeCount={filterMenuCount}
                width={300}
              >
                <FilterMenuContent
                  typeFilter={typeFilter}
                  setTypeFilter={setTypeFilter}
                  allCategories={allCategories}
                  selectedCategories={selectedCategories}
                  setSelectedCategories={setSelectedCategories}
                  tags={tagData.tags}
                  assignments={tagData.assignments}
                  selectedTags={selectedTags}
                  setSelectedTags={setSelectedTags}
                  tagMatchMode={tagMatchMode}
                  setTagMatchMode={setTagMatchMode}
                  untaggedOnly={untaggedOnly}
                  setUntaggedOnly={setUntaggedOnly}
                  toggleSetMember={toggleSetMember}
                />
              </FilterDropdown>
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="text-[var(--muted-foreground)] flex items-center gap-1">
                <FunnelIcon className="w-3 h-3" />
                {activeFilterCount} active
              </span>
              {publishFilter !== 'all' && (
                <ActiveFilterChip label={publishFilter === 'published' ? 'Published' : 'Drafts'} onRemove={() => setPublishFilter('all')} />
              )}
              {typeFilter !== 'all' && (
                <ActiveFilterChip label={typeFilter === 'visual' ? 'Drag & Drop' : 'HTML'} onRemove={() => setTypeFilter('all')} />
              )}
              {[...selectedCategories].map((cat) => (
                <ActiveFilterChip
                  key={`c-${cat}`}
                  label={cat.replace(/-/g, ' ')}
                  prefix="Category:"
                  onRemove={() => setSelectedCategories(toggleSetMember(selectedCategories, cat))}
                />
              ))}
              {untaggedOnly && (
                <ActiveFilterChip label="Untagged" onRemove={() => setUntaggedOnly(false)} />
              )}
              {[...selectedTags].map((tag) => {
                const color = getTagColor(tag);
                return (
                  <ActiveFilterChip
                    key={`t-${tag}`}
                    label={tag}
                    colorClass={color.className}
                    onRemove={() => setSelectedTags(toggleSetMember(selectedTags, tag))}
                  />
                );
              })}
              {search.trim() && (
                <ActiveFilterChip label={`"${search.trim()}"`} prefix="Search:" onRemove={() => setSearch('')} />
              )}
              <button
                onClick={clearAllFilters}
                className="ml-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline-offset-2 hover:underline"
              >
                Clear all
              </button>
            </div>
          )}
      </div>

      {/* Create choice modal — single-step picker. Selecting a builder
          creates the template immediately with a default "Untitled
          Template" name and navigates to the editor, where the user
          can rename it. */}
      {showCreateChoice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in"
          onClick={() => !saving && setShowCreateChoice(false)}
        >
          <div className="glass-modal w-[480px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">Create New Template</h3>
              <button
                onClick={() => !saving && setShowCreateChoice(false)}
                disabled={saving}
                className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-sm text-[var(--muted-foreground)] mb-4">Choose how you&apos;d like to build your template:</p>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => createTemplate('visual')}
                  disabled={saving}
                  className="group flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-[var(--border)] hover:border-[var(--primary)] bg-[var(--card)] hover:bg-[var(--primary)]/5 transition-all text-center disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="w-12 h-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center group-hover:bg-[var(--primary)]/20 transition-colors">
                    <CursorArrowRaysIcon className="w-6 h-6 text-[var(--primary)]" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold mb-1">Drag &amp; Drop</h4>
                    <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">Visual builder with sections</p>
                  </div>
                </button>
                <button
                  onClick={() => createTemplate('code')}
                  disabled={saving}
                  className="group flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-[var(--border)] hover:border-[var(--primary)] bg-[var(--card)] hover:bg-[var(--primary)]/5 transition-all text-center disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="w-12 h-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center group-hover:bg-[var(--primary)]/20 transition-colors">
                    <CodeBracketIcon className="w-6 h-6 text-[var(--primary)]" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold mb-1">HTML Editor</h4>
                    <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">Write or paste raw HTML</p>
                  </div>
                </button>
              </div>
              {saving && (
                <p className="text-[11px] text-[var(--muted-foreground)] text-center mt-4">
                  Creating template…
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Template grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-[var(--border)] rounded-xl">
          <BookOpenIcon className="w-8 h-8 mx-auto mb-3 text-[var(--muted-foreground)]" />
          <p className="text-[var(--muted-foreground)] text-sm">
            {activeFilterCount > 0 ? 'No templates match the current filters.' : 'No templates yet.'}
          </p>
          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="mt-3 text-xs text-[var(--primary)] hover:underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((t) => {
            const tags = tagData.assignments[t.design] || [];
            const isOpen = menuOpen === t.design;
            const isSelected = selectedDesigns.has(t.design);
            const selectionActive = selectedDesigns.size > 0;
            const isDownloading = downloadingDesign === t.design;
            const isPublished = t.published === true;
            const isPublishing = publishingDesign === t.design;
            const templateTypeLabel = getLibraryTemplateTypeLabel(t);
            return (
              <div
                key={t.design}
                className={`group relative glass-card rounded-xl overflow-hidden ${isOpen ? 'z-10' : ''}`}
              >
                {/* Selection ring overlay – renders above iframe */}
                {isSelected && (
                  <div className="absolute inset-0 border-3 border-[var(--primary)] rounded-xl z-20 pointer-events-none" />
                )}
                {/* Preview area */}
                <div
                  className="cursor-pointer relative"
                  onClick={() => setPreviewDesign(t.design)}
                >
                  <TemplatePreview design={t.design} height={220} />
                  {/* Selection checkbox — always visible when any card is selected,
                      hover-revealed otherwise. Click selects without navigating. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleSelect(t.design);
                    }}
                    aria-label={isSelected ? 'Deselect template' : 'Select template'}
                    className={`absolute top-2.5 left-2.5 z-20 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                      isSelected
                        ? 'bg-[var(--primary)] border-[var(--primary)] text-white opacity-100'
                        : `bg-black/40 border-white/80 backdrop-blur-sm text-transparent hover:bg-black/60 ${
                            selectionActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`
                    }`}
                  >
                    <CheckIcon className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Info */}
                <div className="p-3">
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className="text-sm font-medium truncate hover:text-[var(--primary)] transition-colors cursor-pointer"
                      onClick={() => setPreviewDesign(t.design)}
                    >
                      {t.name || formatDesign(t.design)}
                    </span>

                    {/* Menu */}
                    <div className="relative" ref={isOpen ? menuRef : undefined}>
                        <button
                          onClick={() => setMenuOpen(isOpen ? null : t.design)}
                          className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                        >
                          <EllipsisVerticalIcon className="w-4 h-4" />
                        </button>
                        {isOpen && (
                          <div className="absolute right-0 top-full mt-1 z-50 w-56 glass-dropdown">
                            <button
                              onClick={() => { setMenuOpen(null); setPreviewDesign(t.design); }}
                              className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2"
                            >
                              <EyeIcon className="w-4 h-4" />
                              View
                            </button>
                            <button
                              onClick={() => {
                                router.push(buildLibraryEditorHref(t, { campaignDraft: isCampaignDraft }));
                                setMenuOpen(null);
                              }}
                              className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2"
                            >
                              <PencilIcon className="w-4 h-4" />
                              Edit
                            </button>
                            <button
                              onClick={() => { setMenuOpen(null); openRenameModal(t); }}
                              className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2"
                            >
                              <PencilIcon className="w-4 h-4" />
                              Rename
                            </button>
                            <button
                              onClick={() => { setMenuOpen(null); handleDownloadScreenshot(t); }}
                              disabled={isDownloading}
                              className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2 disabled:opacity-60"
                            >
                              {isDownloading ? (
                                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                              ) : (
                                <ArrowDownTrayIcon className="w-4 h-4" />
                              )}
                              {isDownloading ? 'Downloading...' : 'Download PNG'}
                            </button>
                            <button
                              onClick={() => { cloneTemplate(t.design); setMenuOpen(null); }}
                              className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2"
                            >
                              <Square2StackIcon className="w-4 h-4" />
                              Clone
                            </button>
                            {!scoped && (
                              <button
                                onClick={() => {
                                  setMenuOpen(null);
                                  void setPublishedState([t.design], !isPublished);
                                }}
                                disabled={isPublishing}
                                className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-2 disabled:opacity-60"
                              >
                                {isPublished ? (
                                  <>
                                    <PencilSquareIcon className="w-4 h-4" />
                                    Unpublish
                                  </>
                                ) : (
                                  <>
                                    <CheckCircleIcon className="w-4 h-4" />
                                    Publish to Library
                                  </>
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => { deleteTemplate(t.design); setMenuOpen(null); }}
                              className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2"
                            >
                              <TrashIcon className="w-4 h-4" />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                  </div>

                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      {templateTypeLabel}
                    </span>
                    {!scoped && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isPublishing) return;
                          void setPublishedState([t.design], !isPublished);
                        }}
                        disabled={isPublishing}
                        title={isPublished ? 'Click to unpublish' : 'Click to publish to library'}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors disabled:cursor-default ${
                          isPublished
                            ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                            : 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                        }`}
                      >
                        {isPublishing ? (
                          <ArrowPathIcon className="w-3 h-3 animate-spin" />
                        ) : isPublished ? (
                          <CheckCircleIcon className="w-3 h-3" />
                        ) : null}
                        {isPublished ? 'Published' : 'Draft'}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingCategoryFor(editingCategoryFor === t.design ? null : t.design);
                          setEditingTagsFor(null);
                        }}
                        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-px rounded transition-colors ${
                          t.category
                            ? 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                            : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
                        }`}
                        title={t.category ? 'Change category' : 'Set category'}
                      >
                        <FolderIcon className="w-2.5 h-2.5" />
                        {t.category ? (
                          <span className="capitalize">{t.category.replace(/-/g, ' ')}</span>
                        ) : tags.length === 0 ? (
                          <span>category</span>
                        ) : null}
                      </button>
                      {editingCategoryFor === t.design && (
                        <CategoryEditorPopover
                          allCategories={allCategories}
                          current={t.category}
                          onSelect={(c) => { void setCategoryForTemplate(t.design, c); setEditingCategoryFor(null); }}
                          onClear={() => { void setCategoryForTemplate(t.design, null); setEditingCategoryFor(null); }}
                          onCreate={(c) => { void setCategoryForTemplate(t.design, c); setEditingCategoryFor(null); }}
                          popoverRef={cardPopoverRef}
                        />
                      )}
                    </div>
                    {tags.map((tag) => (
                      <TagChip
                        key={tag}
                        tag={tag}
                        size="xs"
                        removable
                        onRemove={() => void setTagsForTemplate(t.design, tags.filter((x) => x !== tag))}
                      />
                    ))}
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingTagsFor(editingTagsFor === t.design ? null : t.design);
                          setEditingCategoryFor(null);
                        }}
                        className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-px rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/5 transition-colors"
                        title="Add tag"
                      >
                        <PlusIcon className="w-2.5 h-2.5" />
                        {tags.length === 0 && <span>tag</span>}
                      </button>
                      {editingTagsFor === t.design && (
                        <TagEditorPopover
                          allTags={tagData.tags}
                          currentTags={Object.fromEntries(
                            tagData.tags.map((tag) => [tag, tags.includes(tag) ? 'all' : 'none'] as const),
                          )}
                          onToggle={(tag) => {
                            const next = tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag];
                            void setTagsForTemplate(t.design, next);
                          }}
                          onCreate={async (tag) => {
                            await setTagsForTemplate(t.design, [...tags, tag]);
                          }}
                          popoverRef={cardPopoverRef}
                        />
                      )}
                    </div>
                  </div>

                  {(t.createdBy || t.updatedBy) && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {(() => {
                        const avatar = t.updatedByAvatar || t.createdByAvatar;
                        const name = t.updatedBy || t.createdBy;
                        const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '';
                        return avatar ? (
                          <img src={avatar} alt="" className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <span className="w-4 h-4 rounded-full bg-[var(--muted)] flex items-center justify-center text-[7px] font-semibold text-[var(--muted-foreground)] flex-shrink-0">{initials}</span>
                        );
                      })()}
                      <span className="text-[10px] text-[var(--muted-foreground)] truncate">
                        {t.updatedBy ? `Edited by ${t.updatedBy}` : `By ${t.createdBy}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-[var(--muted-foreground)] mt-4">
        {filtered.length} template{filtered.length !== 1 ? 's' : ''} available
      </p>

      {/* Modals */}
      {showTagModal && (
        <ManageTagsModal
          tagData={tagData}
          onSave={saveTagData}
          onClose={() => setShowTagModal(false)}
        />
      )}
      {renameDesign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={closeRenameModal}>
          <div className="glass-modal w-[460px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">Rename Template</h3>
              <button
                onClick={closeRenameModal}
                disabled={renaming}
                className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleRenameTemplate();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    closeRenameModal();
                  }
                }}
                placeholder="Template name"
                autoFocus
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
              <button
                onClick={closeRenameModal}
                disabled={renaming}
                className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleRenameTemplate(); }}
                disabled={renaming || !renameValue.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--primary)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {renaming ? 'Renaming...' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewDesign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={() => setPreviewDesign(null)}>
          <div className="glass-modal w-[720px] h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
              <div className="min-w-0">
                <h3 className="text-base font-semibold truncate">
                  {tplMap[previewDesign]?.name || formatDesign(previewDesign)}
                </h3>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => openLibraryPreviewInNewTab(previewDesign)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--foreground)] border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                >
                  <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" /> Preview in New Tab
                </button>
                <button
                  onClick={() => {
                    setPreviewDesign(null);
                    router.push(buildLibraryEditorHref(
                      previewDesign,
                      {
                        campaignDraft: isCampaignDraft,
                        editorType: tplMap[previewDesign]?.editorType,
                      },
                    ));
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--primary)] border border-[var(--primary)]/30 rounded-lg hover:bg-[var(--primary)]/5 transition-colors"
                >
                  <PencilSquareIcon className="w-3.5 h-3.5" /> Edit
                </button>
                <button onClick={() => setPreviewDesign(null)} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <TemplatePreview design={previewDesign} interactive />
            </div>
          </div>
        </div>
      )}

      {/* Bulk action dock — appears when at least one template is selected. */}
      {selectedDesigns.size > 0 && (
        <BulkActionDock
          count={selectedDesigns.size}
          itemLabel={selectedDesigns.size === 1 ? 'template' : 'templates'}
          actions={(() => {
            const slugs = Array.from(selectedDesigns);
            const filteredSlugs = filtered.map((t) => t.design);
            const allFilteredSelected =
              filteredSlugs.length > 0 && filteredSlugs.every((d) => selectedDesigns.has(d));
            const actions: BulkActionDockItem[] = [
              {
                id: 'select-page',
                label: allFilteredSelected ? 'Deselect page' : 'Select page',
                icon: <CheckIcon className="w-4 h-4" />,
                onClick: () => {
                  if (allFilteredSelected) {
                    setSelectedDesigns(new Set());
                  } else {
                    setSelectedDesigns(new Set(filteredSlugs));
                  }
                },
              },
              ...(scoped
                ? []
                : [
                    {
                      id: 'publish',
                      label: 'Publish',
                      icon: <CheckCircleIcon className="w-4 h-4" />,
                      onClick: async () => {
                        await setPublishedState(slugs, true);
                        setSelectedDesigns(new Set());
                      },
                    },
                    {
                      id: 'unpublish',
                      label: 'Unpublish',
                      icon: <PencilSquareIcon className="w-4 h-4" />,
                      onClick: async () => {
                        await setPublishedState(slugs, false);
                        setSelectedDesigns(new Set());
                      },
                    },
                  ]),
              {
                id: 'tag',
                label: 'Tag',
                icon: <TagIcon className="w-4 h-4" />,
                onClick: () => setBulkTagModalOpen(true),
              },
              {
                id: 'delete',
                label: 'Delete',
                icon: <TrashIcon className="w-4 h-4" />,
                onClick: handleBulkDelete,
                danger: true,
              },
            ];
            return actions;
          })()}
          onClose={() => setSelectedDesigns(new Set())}
        />
      )}

      {/* Bulk tag modal */}
      {bulkTagModalOpen && (
        <BulkTagModal
          selectedDesigns={Array.from(selectedDesigns)}
          tags={tagData.tags}
          assignments={tagData.assignments}
          onApply={(tag, action) => applyTagToTemplates(tag, Array.from(selectedDesigns), action)}
          onClose={() => setBulkTagModalOpen(false)}
        />
      )}

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ── Bulk Tag Modal — applies tags to multiple selected templates ──
// ═══════════════════════════════════════════════════════════════════

function BulkTagModal({
  selectedDesigns,
  tags,
  assignments,
  onApply,
  onClose,
}: {
  selectedDesigns: string[];
  tags: string[];
  assignments: Record<string, string[]>;
  onApply: (tag: string, action: 'add' | 'remove') => Promise<void> | void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  // Compute tri-state for each tag across the selection.
  const tagState: Record<string, 'all' | 'some' | 'none'> = {};
  for (const tag of tags) {
    let count = 0;
    for (const slug of selectedDesigns) {
      if ((assignments[slug] || []).includes(tag)) count += 1;
    }
    if (count === 0) tagState[tag] = 'none';
    else if (count === selectedDesigns.length) tagState[tag] = 'all';
    else tagState[tag] = 'some';
  }

  const filtered = tags.filter((t) => t.toLowerCase().includes(query.toLowerCase()));
  const trimmed = query.trim();
  const showCreate =
    trimmed.length > 0 &&
    !tags.some((t) => t.toLowerCase() === trimmed.toLowerCase());

  const count = selectedDesigns.length;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-card glass-card-strong w-full max-w-md rounded-2xl border border-[var(--border)] p-5"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold">Edit tags</h3>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              Toggle tags on {count} selected template{count === 1 ? '' : 's'}. Mixed selections show a dash.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/60"
            aria-label="Close"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && showCreate) {
                await onApply(trimmed, 'add');
                setQuery('');
              }
            }}
            placeholder="Search or create…"
            autoFocus
            className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
          />
        </div>

        <div className="max-h-72 overflow-y-auto -mx-1 px-1">
          {filtered.length === 0 && !showCreate && (
            <p className="px-2 py-3 text-[11px] text-[var(--muted-foreground)] italic text-center">
              No tags match.
            </p>
          )}
          {filtered.map((tag) => {
            const state = tagState[tag] || 'none';
            const color = getTagColor(tag);
            return (
              <button
                key={tag}
                onClick={() => onApply(tag, state === 'none' ? 'add' : 'remove')}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-[var(--muted)] transition-colors text-left"
              >
                <span className="flex items-center justify-center w-4 h-4">
                  {state === 'all' && <CheckIcon className="w-4 h-4 text-[var(--primary)]" />}
                  {state === 'some' && <span className="w-2 h-0.5 bg-[var(--primary)] rounded" />}
                </span>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${color.className.split(' ')[0]}`} />
                <span className="flex-1 truncate">{tag}</span>
              </button>
            );
          })}
          {showCreate && (
            <button
              onClick={async () => {
                await onApply(trimmed, 'add');
                setQuery('');
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-[var(--muted)] transition-colors text-left text-[var(--primary)]"
            >
              <PlusIcon className="w-4 h-4" />
              <span>Create &ldquo;{trimmed}&rdquo;</span>
            </button>
          )}
        </div>

        <div className="flex justify-end mt-4 pt-3 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 h-9 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--muted-foreground)]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ── Read-Only View (client role: only published templates, no edit) ──
// ═══════════════════════════════════════════════════════════════════

function ReadOnlyView({
  campaignDraftQuery,
  accountKey,
  embedded,
  copyTargetAccountKey,
  copyTargetAccountLabel,
  onCopyComplete,
}: {
  campaignDraftQuery: string;
  // When set, fetch templates owned by this subaccount (no publishedOnly).
  // When unset, fetch published library templates.
  accountKey?: string;
  embedded?: boolean;
  // When set, show a "Copy to Subaccount" action that clones the library
  // template into this subaccount. Ignored when `accountKey` is set
  // (subaccount-scoped views don't show this action).
  copyTargetAccountKey?: string;
  copyTargetAccountLabel?: string;
  onCopyComplete?: () => void;
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [tagData, setTagData] = useState<TagData>({ tags: [], assignments: {} });
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [tagMatchMode, setTagMatchMode] = useState<TagMatchMode>('any');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [previewDesign, setPreviewDesign] = useState<string | null>(null);
  const [copyingDesign, setCopyingDesign] = useState<string | null>(null);
  const filterPopoverRef = useRef<HTMLDivElement>(null);
  const isCampaignDraft = campaignDraftQuery.length > 0;
  const showCopyAction = Boolean(copyTargetAccountKey) && !accountKey;

  useEffect(() => {
    const listUrl = accountKey
      ? `/api/templates?accountKey=${encodeURIComponent(accountKey)}`
      : '/api/templates?publishedOnly=true';
    Promise.all([
      fetch(listUrl).then((r) => r.json()),
      fetch('/api/template-tags').then((r) => r.json()),
    ]).then(([tData, tagResult]) => {
      setTemplates(Array.isArray(tData) ? tData : []);
      setTagData(parseTemplateTagsPayload(tagResult));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [accountKey]);

  const copyToSubaccount = async (design: string) => {
    if (!copyTargetAccountKey || copyingDesign) return;
    setCopyingDesign(design);
    try {
      const res = await fetch('/api/templates/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceDesign: design, accountKey: copyTargetAccountKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to copy template');
        return;
      }
      const label = copyTargetAccountLabel || 'subaccount';
      toast.success(`Copied to ${label}`);
      onCopyComplete?.();
    } catch {
      toast.error('Failed to copy template');
    } finally {
      setCopyingDesign(null);
    }
  };

  useEffect(() => {
    if (!showFilterMenu) return;
    const handler = (e: MouseEvent) => {
      if (!filterPopoverRef.current?.contains(e.target as Node)) setShowFilterMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showFilterMenu]);

  const filtered = useMemo(() => {
    let list = templates;
    if (typeFilter === 'visual') list = list.filter((t) => t.editorType === 'visual');
    else if (typeFilter === 'code') list = list.filter((t) => t.editorType !== 'visual');
    if (selectedCategories.size > 0) {
      list = list.filter((t) => t.category != null && selectedCategories.has(t.category));
    }
    if (selectedTags.size > 0) {
      list = list.filter((t) => {
        const tags = tagData.assignments[t.design] || [];
        if (tagMatchMode === 'all') {
          for (const wanted of selectedTags) if (!tags.includes(wanted)) return false;
          return true;
        }
        for (const tag of tags) if (selectedTags.has(tag)) return true;
        return false;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => {
        const tags = tagData.assignments[t.design] || [];
        return (
          t.name.toLowerCase().includes(q) ||
          t.design.toLowerCase().includes(q) ||
          (t.category != null && t.category.toLowerCase().includes(q)) ||
          tags.some((tag) => tag.toLowerCase().includes(q))
        );
      });
    }
    return list;
  }, [templates, typeFilter, selectedCategories, selectedTags, tagMatchMode, search, tagData]);

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const t of templates) if (t.category) set.add(t.category);
    return [...set].sort();
  }, [templates]);

  const activeFilterCount =
    (typeFilter !== 'all' ? 1 : 0) +
    selectedCategories.size +
    selectedTags.size +
    (search.trim() ? 1 : 0);

  const clearAllFilters = () => {
    setSearch('');
    setTypeFilter('all');
    setSelectedCategories(new Set());
    setSelectedTags(new Set());
    setTagMatchMode('any');
  };

  const toggleInSet = <T extends string>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  if (!loaded) {
    return <div className="text-[var(--muted-foreground)]">Loading...</div>;
  }

  return (
    <div>
      {!embedded && (
        <div className="page-sticky-header mb-6">
          <div className="flex items-center gap-3">
            <BookOpenIcon className="w-7 h-7 text-[var(--primary)] flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">Templates</h1>
              <p className="text-[var(--muted-foreground)] text-sm mt-0.5">
                Browse the shared template library.
              </p>
            </div>
          </div>
        </div>
      )}

      {isCampaignDraft && (
        <div className="mb-4 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-2 text-xs text-[var(--muted-foreground)]">
          Select a template to open it in the editor, then click <span className="text-[var(--foreground)] font-medium">Schedule</span>.
        </div>
      )}

      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, tag, category…"
              className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
            />
          </div>
          <FilterDropdown
            label="Filter"
            icon={<FunnelIcon className="w-3.5 h-3.5" />}
            open={showFilterMenu}
            onOpenChange={setShowFilterMenu}
            popoverRef={showFilterMenu ? filterPopoverRef : undefined}
            badgeCount={
              (typeFilter !== 'all' ? 1 : 0) + selectedCategories.size + selectedTags.size
            }
            width={300}
          >
            <FilterMenuContent
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              allCategories={allCategories}
              selectedCategories={selectedCategories}
              setSelectedCategories={setSelectedCategories}
              tags={tagData.tags}
              assignments={tagData.assignments}
              selectedTags={selectedTags}
              setSelectedTags={setSelectedTags}
              tagMatchMode={tagMatchMode}
              setTagMatchMode={setTagMatchMode}
              toggleSetMember={toggleInSet}
            />
          </FilterDropdown>
        </div>

        {activeFilterCount > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="text-[var(--muted-foreground)] flex items-center gap-1">
              <FunnelIcon className="w-3 h-3" />
              {activeFilterCount} active
            </span>
            {typeFilter !== 'all' && (
              <ActiveFilterChip label={typeFilter === 'visual' ? 'Drag & Drop' : 'HTML'} onRemove={() => setTypeFilter('all')} />
            )}
            {[...selectedCategories].map((cat) => (
              <ActiveFilterChip key={`c-${cat}`} label={cat.replace(/-/g, ' ')} prefix="Category:" onRemove={() => setSelectedCategories(toggleInSet(selectedCategories, cat))} />
            ))}
            {[...selectedTags].map((tag) => {
              const color = getTagColor(tag);
              return (
                <ActiveFilterChip key={`t-${tag}`} label={tag} colorClass={color.className} onRemove={() => setSelectedTags(toggleInSet(selectedTags, tag))} />
              );
            })}
            {search.trim() && (
              <ActiveFilterChip label={`"${search.trim()}"`} prefix="Search:" onRemove={() => setSearch('')} />
            )}
            <button
              onClick={clearAllFilters}
              className="ml-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline-offset-2 hover:underline"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-[var(--border)] rounded-xl">
          <BookOpenIcon className="w-8 h-8 mx-auto mb-3 text-[var(--muted-foreground)]" />
          <p className="text-[var(--muted-foreground)] text-sm">
            {activeFilterCount > 0 ? 'No templates match the current filters.' : 'No templates available.'}
          </p>
          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="mt-3 text-xs text-[var(--primary)] hover:underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((t) => {
            const tags = tagData.assignments[t.design] || [];
            const templateTypeLabel = getLibraryTemplateTypeLabel(t);
            return (
              <div
                key={t.design}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (isCampaignDraft) {
                    router.push(buildLibraryEditorHref(t, { campaignDraft: isCampaignDraft }));
                  } else {
                    setPreviewDesign(t.design);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if (isCampaignDraft) {
                      router.push(buildLibraryEditorHref(t, { campaignDraft: isCampaignDraft }));
                    } else {
                      setPreviewDesign(t.design);
                    }
                  }
                }}
                className="glass-card rounded-xl overflow-hidden cursor-pointer hover:border-[var(--primary)]/40 transition-colors"
              >
                <TemplatePreview design={t.design} height={220} />
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">
                      {t.name || formatDesign(t.design)}
                    </p>
                    {showCopyAction && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyToSubaccount(t.design);
                        }}
                        disabled={copyingDesign === t.design}
                        title={copyTargetAccountLabel ? `Copy to ${copyTargetAccountLabel}` : 'Copy to subaccount'}
                        className="flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/5 transition-colors disabled:opacity-60 disabled:cursor-wait"
                      >
                        {copyingDesign === t.design ? (
                          <ArrowPathIcon className="w-3 h-3 animate-spin" />
                        ) : (
                          <Square2StackIcon className="w-3 h-3" />
                        )}
                        Copy
                      </button>
                    )}
                  </div>
                  <div className="mt-1.5">
                    <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      {templateTypeLabel}
                    </span>
                  </div>
                  {(t.category || tags.length > 0) && (
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      {t.category && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-px rounded bg-[var(--muted)] text-[var(--muted-foreground)]">
                          <FolderIcon className="w-2.5 h-2.5" />
                          <span className="capitalize">{t.category.replace(/-/g, ' ')}</span>
                        </span>
                      )}
                      {tags.map((tag) => (
                        <TagChip key={tag} tag={tag} size="xs" />
                      ))}
                    </div>
                  )}
                  {(t.createdBy || t.updatedBy) && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {(() => {
                        const avatar = t.updatedByAvatar || t.createdByAvatar;
                        const name = t.updatedBy || t.createdBy;
                        const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '';
                        return avatar ? (
                          <img src={avatar} alt="" className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <span className="w-4 h-4 rounded-full bg-[var(--muted)] flex items-center justify-center text-[7px] font-semibold text-[var(--muted-foreground)] flex-shrink-0">{initials}</span>
                        );
                      })()}
                      <span className="text-[10px] text-[var(--muted-foreground)] truncate">
                        {t.updatedBy ? `Edited by ${t.updatedBy}` : `By ${t.createdBy}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-[var(--muted-foreground)] mt-4">
        {filtered.length} template{filtered.length !== 1 ? 's' : ''} available
      </p>

      {/* Preview Modal */}
      {previewDesign && (() => {
        const pt = templates.find((t) => t.design === previewDesign);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={() => setPreviewDesign(null)}>
            <div className="glass-modal w-[720px] h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold truncate">
                    {pt?.name || formatDesign(previewDesign)}
                  </h3>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => openLibraryPreviewInNewTab(previewDesign)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--foreground)] border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                  >
                    <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" /> Preview in New Tab
                  </button>
                  <button
                    onClick={() => {
                      setPreviewDesign(null);
                      router.push(buildLibraryEditorHref(
                        previewDesign,
                        { campaignDraft: isCampaignDraft, editorType: pt?.editorType },
                      ));
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--primary)] border border-[var(--primary)]/30 rounded-lg hover:bg-[var(--primary)]/5 transition-colors"
                  >
                    <PencilSquareIcon className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button onClick={() => setPreviewDesign(null)} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                    <XMarkIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <TemplatePreview design={previewDesign} interactive />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ── Manage Tags Modal ──
// ═══════════════════════════════════════════════════════════════════

function ManageTagsModal({
  tagData, onSave, onClose,
}: {
  tagData: TagData;
  onSave: (data: TagData) => void; onClose: () => void;
}) {
  const { confirm } = useLoomiDialog();
  const [local, setLocal] = useState<TagData>(JSON.parse(JSON.stringify(tagData)));
  const [newTagName, setNewTagName] = useState('');
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editTagValue, setEditTagValue] = useState('');

  const addTag = () => {
    const name = newTagName.trim();
    if (!name) return;
    if (local.tags.some((t) => t.toLowerCase() === name.toLowerCase())) return;
    setLocal({ ...local, tags: [...local.tags, name] });
    setNewTagName('');
  };

  const renameTag = (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) { setEditingTag(null); return; }
    if (local.tags.some((t) => t !== oldName && t.toLowerCase() === trimmed.toLowerCase())) { setEditingTag(null); return; }
    const newTags = local.tags.map((t) => (t === oldName ? trimmed : t));
    const newAssignments: Record<string, string[]> = {};
    for (const [key, tags] of Object.entries(local.assignments)) {
      newAssignments[key] = tags.map((t) => (t === oldName ? trimmed : t));
    }
    setLocal({ tags: newTags, assignments: newAssignments });
    setEditingTag(null);
  };

  const deleteTag = async (tagName: string) => {
    const count = Object.values(local.assignments).filter((tags) => tags.includes(tagName)).length;
    if (count > 0) {
      const confirmed = await confirm({
        title: 'Remove Tag',
        message: `Remove "${tagName}" tag from ${count} template${count > 1 ? 's' : ''}?`,
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!confirmed) return;
    }
    const newTags = local.tags.filter((t) => t !== tagName);
    const newAssignments: Record<string, string[]> = {};
    for (const [key, tags] of Object.entries(local.assignments)) {
      const filtered = tags.filter((t) => t !== tagName);
      if (filtered.length > 0) newAssignments[key] = filtered;
    }
    setLocal({ tags: newTags, assignments: newAssignments });
  };

  const getTagCount = (tagName: string) =>
    Object.values(local.assignments).filter((tags) => tags.includes(tagName)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={onClose}>
      <div className="glass-modal w-[480px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div>
            <h3 className="text-sm font-semibold">Manage Tags</h3>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">Create, rename, and remove tags.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Tags */}
          <div>
            <div className="space-y-1.5">
              {local.tags.length === 0 && (
                <p className="text-[11px] text-[var(--muted-foreground)] italic py-4 text-center">
                  No tags yet. Create one below or add one inline from a template card.
                </p>
              )}
              {local.tags.map((tag) => {
                const color = getTagColor(tag);
                return (
                  <div key={tag} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)]">
                    <span className={`inline-block w-2 h-2 rounded-full ${color.className.split(' ')[0]}`} />
                    {editingTag === tag ? (
                      <input
                        type="text"
                        value={editTagValue}
                        onChange={(e) => setEditTagValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') renameTag(tag, editTagValue); if (e.key === 'Escape') setEditingTag(null); }}
                        onBlur={() => renameTag(tag, editTagValue)}
                        className="flex-1 text-sm bg-transparent border-none outline-none text-[var(--foreground)]"
                        autoFocus
                      />
                    ) : (
                      <span className="flex-1 text-sm font-medium">{tag}</span>
                    )}
                    <span className="text-[10px] text-[var(--muted-foreground)] tabular-nums">{getTagCount(tag)}</span>
                    <button onClick={() => { setEditingTag(tag); setEditTagValue(tag); }} className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors" title="Rename">
                      <PencilIcon className="w-3 h-3" />
                    </button>
                    <button onClick={() => { void deleteTag(tag); }} className="p-1 rounded text-[var(--muted-foreground)] hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Delete tag">
                      <XMarkIcon className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <input type="text" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} className="flex-1 text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--foreground)]" placeholder="New tag name..." />
              <PrimaryButton onClick={addTag} disabled={!newTagName.trim()}>Add</PrimaryButton>
            </div>
          </div>

          <p className="text-[11px] text-[var(--muted-foreground)] -mt-1">
            Assign tags to templates directly from the library — click the <span className="inline-flex items-center gap-0.5 text-[var(--muted-foreground)]"><PlusIcon className="w-3 h-3 inline" />tag</span> button on any template card.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border)] bg-[var(--muted)]/30 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors">Cancel</button>
          <PrimaryButton onClick={() => onSave(local)}>Save</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

