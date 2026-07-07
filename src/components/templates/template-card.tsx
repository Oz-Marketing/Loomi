'use client';

/**
 * The ONE template card used across every /templates tab (Email, Forms, Landing
 * Pages, Ads). Structurally the Ads card — a preview, a ⋯ action menu, and a
 * meta strip — but props-driven so each surface maps its own data.
 *
 * Design notes (per product direction):
 * - The author avatar is a CIRCLE.
 * - The status badge sits on the SAME line as the author name; there is NO
 *   timestamp.
 * - For client roles the author name + avatar are hidden (only the status badge
 *   shows), since clients don't need to see who authored a template.
 *
 * Category + Tags are the shared taxonomy every kind uses; when `editable`, the
 * card offers the same inline category/tag popovers the email library uses.
 */
import { useEffect, useRef, useState } from 'react';
import {
  EllipsisVerticalIcon,
  BuildingStorefrontIcon,
  GlobeAltIcon,
  FolderIcon,
  PlusIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { UserAvatar } from '@/components/user-avatar';
import { TagChip, TagEditorPopover, CategoryEditorPopover } from '@/components/templates/taxonomy-controls';

export type TemplateCardStatus = 'draft' | 'published';

export interface TemplateCardAction {
  key: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  run: () => void;
  danger?: boolean;
  /** Rendered dimmed; `run` still fires (e.g. to explain why it's unavailable). */
  disabled?: boolean;
}

export interface TemplateCardProps {
  /** Preview thumbnail — each tab supplies its own (AdPreviewThumb, FormPreviewThumbnail, …). */
  preview: ReactNode;
  name: string;
  status?: TemplateCardStatus;
  /** Optional scope line (account name / "All accounts"). */
  scope?: { label: string; kind: 'account' | 'global' };
  category?: string | null;
  tags?: string[];
  /** Shared vocabulary powering the category/tag popovers. */
  taxonomy?: { categories: string[]; tags: string[] };
  author?: { name?: string | null; email?: string | null; avatarUrl?: string | null };
  /** Hide author name + avatar (client roles). */
  isClient?: boolean;
  /** Show inline category/tag editing (admins/managers). */
  editable?: boolean;
  /** Extra badges (e.g. an ad's Scheduled/Expired badge). */
  badges?: ReactNode;
  actions?: TemplateCardAction[];
  onClick?: () => void;
  onCategoryChange?: (category: string | null) => void;
  onTagsChange?: (tags: string[]) => void;
  /** Multi-select (bulk actions) — email library. Renders a hover checkbox. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

function StatusBadge({ status }: { status: TemplateCardStatus }) {
  const published = status === 'published';
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
        published
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
      }`}
    >
      {published ? 'Published' : 'Draft'}
    </span>
  );
}

export function TemplateCard({
  preview,
  name,
  status,
  scope,
  category,
  tags = [],
  taxonomy = { categories: [], tags: [] },
  author,
  isClient = false,
  editable = false,
  badges,
  actions = [],
  onClick,
  onCategoryChange,
  onTagsChange,
  selectable = false,
  selected = false,
  onToggleSelect,
}: TemplateCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingCat, setEditingCat] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const catRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen && !editingCat && !editingTags) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuOpen && !menuRef.current?.contains(t)) setMenuOpen(false);
      if (editingCat && !catRef.current?.contains(t)) setEditingCat(false);
      if (editingTags && !tagRef.current?.contains(t)) setEditingTags(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen, editingCat, editingTags]);

  const canEditTaxonomy = editable && (!!onCategoryChange || !!onTagsChange);
  const allTags = Array.from(new Set([...taxonomy.tags, ...tags]));
  const showAuthor = !isClient && !!author && (!!author.name || !!author.email || !!author.avatarUrl);
  const showAuthorLine = !!status || showAuthor;

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
      className={`glass-card group relative rounded-2xl border text-left transition-colors ${
        selected ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]' : 'border-[var(--border)]'
      } ${onClick ? 'cursor-pointer hover:border-[var(--primary)]' : ''}`}
    >
      <div className="overflow-hidden rounded-t-2xl">{preview}</div>

      {/* Multi-select checkbox (email library) */}
      {selectable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.();
          }}
          aria-label={selected ? 'Deselect' : 'Select'}
          className={`absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 backdrop-blur transition-opacity ${
            selected
              ? 'border-[var(--primary)] bg-[var(--primary)] text-white opacity-100'
              : 'border-white/70 bg-black/30 text-transparent opacity-0 group-hover:opacity-100'
          }`}
        >
          <CheckIcon className="h-3.5 w-3.5" />
        </button>
      )}

      {/* ⋯ action menu */}
      {actions.length > 0 && (
        <div className="absolute right-2 top-2" ref={menuRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            title="Actions"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--card-strong)]/90 text-[var(--muted-foreground)] backdrop-blur transition-colors hover:text-[var(--foreground)]"
          >
            <EllipsisVerticalIcon className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 w-44 glass-dropdown" onClick={(e) => e.stopPropagation()}>
              {actions.map((a) => (
                <button
                  key={a.key}
                  onClick={() => {
                    setMenuOpen(false);
                    a.run();
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted)] ${
                    a.disabled ? 'text-[var(--muted-foreground)] opacity-60' : a.danger ? 'text-red-500' : 'text-[var(--foreground)]'
                  }`}
                >
                  <a.icon className="h-4 w-4" />
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="p-3">
        <div className="truncate text-sm font-semibold text-[var(--foreground)]">{name}</div>

        {badges && <div className="mt-0.5 flex flex-wrap items-center gap-1">{badges}</div>}

        {/* Category + Tags */}
        {(canEditTaxonomy || category || tags.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {/* Category */}
            {canEditTaxonomy ? (
              <div className="relative" ref={catRef}>
                <button
                  onClick={() => {
                    setEditingCat((v) => !v);
                    setEditingTags(false);
                  }}
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] transition-colors ${
                    category
                      ? 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                      : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)]'
                  }`}
                >
                  <FolderIcon className="w-2.5 h-2.5" />
                  {category ? <span className="capitalize">{category.replace(/-/g, ' ')}</span> : <span>category</span>}
                </button>
                {editingCat && (
                  <CategoryEditorPopover
                    allCategories={taxonomy.categories}
                    current={category}
                    onSelect={(c) => {
                      onCategoryChange?.(c);
                      setEditingCat(false);
                    }}
                    onClear={() => {
                      onCategoryChange?.(null);
                      setEditingCat(false);
                    }}
                    onCreate={(c) => {
                      onCategoryChange?.(c);
                      setEditingCat(false);
                    }}
                    popoverRef={catRef}
                  />
                )}
              </div>
            ) : (
              category && (
                <span className="inline-flex items-center gap-1 rounded bg-[var(--muted)] px-1.5 py-px text-[10px] text-[var(--muted-foreground)]">
                  <FolderIcon className="w-2.5 h-2.5" />
                  <span className="capitalize">{category.replace(/-/g, ' ')}</span>
                </span>
              )
            )}

            {/* Tags */}
            {tags.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                size="xs"
                removable={canEditTaxonomy}
                onRemove={canEditTaxonomy ? () => onTagsChange?.(tags.filter((x) => x !== tag)) : undefined}
              />
            ))}

            {canEditTaxonomy && onTagsChange && (
              <div className="relative" ref={tagRef}>
                <button
                  onClick={() => {
                    setEditingTags((v) => !v);
                    setEditingCat(false);
                  }}
                  title="Add tag"
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-px text-[10px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--primary)]/5 hover:text-[var(--primary)]"
                >
                  <PlusIcon className="w-2.5 h-2.5" />
                  {tags.length === 0 && <span>tag</span>}
                </button>
                {editingTags && (
                  <TagEditorPopover
                    allTags={allTags}
                    currentTags={Object.fromEntries(allTags.map((t) => [t, tags.includes(t) ? 'all' : 'none'] as const))}
                    onToggle={(tag) =>
                      onTagsChange(tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag])
                    }
                    onCreate={(tag) => onTagsChange([...tags, tag])}
                    popoverRef={tagRef}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Scope */}
        {scope && (
          <span className="mt-1 flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
            {scope.kind === 'account' ? (
              <BuildingStorefrontIcon className="h-3.5 w-3.5 flex-shrink-0" />
            ) : (
              <GlobeAltIcon className="h-3.5 w-3.5 flex-shrink-0" />
            )}
            <span className="truncate">{scope.label}</span>
          </span>
        )}

        {/* Authorship: status badge + circle avatar + name (name/avatar hidden for clients), no timestamp */}
        {showAuthorLine && (
          <div className="mt-2 flex items-center gap-2 border-t border-[var(--border)] pt-2">
            {status && <StatusBadge status={status} />}
            {showAuthor && (
              <span className="flex min-w-0 items-center gap-1.5">
                <UserAvatar
                  name={author!.name}
                  email={author!.email}
                  avatarUrl={author!.avatarUrl}
                  size={18}
                  className="rounded-full flex-shrink-0"
                />
                <span className="truncate text-[11px] text-[var(--muted-foreground)]">{author!.name || 'Someone'}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
