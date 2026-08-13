'use client';

/**
 * Ad Size Library — the one list of sizes the Ad Generator designs against.
 *
 * Every size here is the same kind of thing: there's no built-in tier and no
 * "custom" pile. What a size is FOR is carried by its tags ("Facebook",
 * "Display", "Email"), which are free-form, editable inline, and used as filters
 * rather than folders — a 1080×1080 that runs on Instagram and in email says so
 * by carrying both tags.
 *
 * Anyone signed in can add, rename, resize, retag, or remove one; each row shows
 * who created it and when. Behind AD_GENERATOR_ENABLED (the route layout 404s
 * when off).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  PlusIcon,
  TrashIcon,
  PencilSquareIcon,
  CheckIcon,
  XMarkIcon,
  RectangleGroupIcon,
  MegaphoneIcon,
  Squares2X2Icon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { UserAvatar } from '@/components/user-avatar';
import { HelpTip } from '@/components/ui/help-tip';
import { TagChip, TagEditorPopover } from '@/components/templates/taxonomy-controls';
import { TagFilterChips, RatioSwatch } from '@/components/ad-generator/size-picker';
import { aspectLabel, filterSizes, normalizeTags, type LibrarySize } from '@/lib/ad-generator/ad-size-library';
import { useSizeLibrary } from '@/lib/ad-generator/use-size-library';

export default function AdSizesPage() {
  const { accountKey } = useAccount();
  const { confirm } = useLoomiDialog();
  const { sizes, facets, allTags, loading, reload } = useSizeLibrary();

  const [name, setName] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [newTags, setNewTags] = useState('');
  const [busy, setBusy] = useState(false);

  // Browsing: tag chips filter (OR), plus a text search over name/dimensions.
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  // Inline edit state (one row at a time).
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editWidth, setEditWidth] = useState('');
  const [editHeight, setEditHeight] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Which row's tag popover is open (tags save immediately, no edit mode).
  const [tagFor, setTagFor] = useState<string | null>(null);
  const tagRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!tagFor) return;
    const onDown = (e: MouseEvent) => {
      if (!tagRef.current?.contains(e.target as Node)) setTagFor(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [tagFor]);

  // Sizes are global, but preserve the active sub-account across the back-links
  // (the generator is an admin-level route that reads ?account=).
  const acctQuery = accountKey ? `?account=${encodeURIComponent(accountKey)}` : '';

  const shown = useMemo(() => filterSizes(sizes, tagFilter, query), [sizes, tagFilter, query]);

  async function create() {
    const w = Number(width);
    const h = Number(height);
    if (!name.trim() || !(w > 0) || !(h > 0)) {
      toast.error('Name, width, and height are required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/ad-generator/sizes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), width: w, height: h, tags: normalizeTags(newTags.split(',')) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      setName('');
      setWidth('');
      setHeight('');
      setNewTags('');
      toast.success('Size added');
      void reload();
    } catch (err) {
      toast.error(`Couldn't add: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(s: LibrarySize) {
    setEditId(s.id);
    setEditName(s.name);
    setEditWidth(String(s.width));
    setEditHeight(String(s.height));
  }

  function cancelEdit() {
    setEditId(null);
  }

  async function patchSize(id: string, body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/ad-generator/sizes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
    return true;
  }

  async function saveEdit(id: string) {
    const w = Number(editWidth);
    const h = Number(editHeight);
    if (!editName.trim() || !(w > 0) || !(h > 0)) {
      toast.error('Name, width, and height are required');
      return;
    }
    setSavingEdit(true);
    try {
      await patchSize(id, { name: editName.trim(), width: w, height: h });
      setEditId(null);
      toast.success('Size updated');
      void reload();
    } catch (err) {
      toast.error(`Couldn't update: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setSavingEdit(false);
    }
  }

  async function saveTags(s: LibrarySize, tags: string[]) {
    try {
      await patchSize(s.id, { tags });
      void reload();
    } catch (err) {
      toast.error(`Couldn't save tags: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  async function remove(s: LibrarySize) {
    const ok = await confirm({
      title: 'Remove size?',
      message: `"${s.name}" (${s.width}×${s.height}) will be removed from the library. Existing ads keep their layouts — this only affects new "add size" picks.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/ad-generator/sizes/${s.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Removed');
      void reload();
    } catch (err) {
      toast.error(`Couldn't remove: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  return (
    <div>
      <div className="page-sticky-header mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <RectangleGroupIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-bold">Ad Sizes</h2>
              <p className="text-[var(--muted-foreground)] mt-1">
                Every size the ad builder can design against. Anyone can add, edit, tag, or remove one.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Link
              href={`/ad-generator${acctQuery}`}
              className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <MegaphoneIcon className="w-4 h-4" />
              Ad Generator
            </Link>
            <Link
              href={`/ad-generator/builder${acctQuery}`}
              className="flex items-center gap-1.5 px-3 h-10 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Squares2X2Icon className="w-4 h-4" />
              Template Builder
            </Link>
          </div>
        </div>
      </div>

      {/* Create */}
      <div className="glass-card mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--border)] p-4">
        <label className="min-w-[10rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Square 1080"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </label>
        <label className="w-24">
          <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Width</span>
          <input
            type="number"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            placeholder="1080"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </label>
        <span className="pb-2 text-[var(--muted-foreground)]">×</span>
        <label className="w-24">
          <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">Height</span>
          <input
            type="number"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </label>
        <label className="min-w-[12rem] flex-1">
          <span className="mb-1 flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Used for
            <HelpTip title="Tags" iconClassName="w-3.5 h-3.5">
              <p>
                What this size is used for — &ldquo;Facebook&rdquo;, &ldquo;Display&rdquo;, &ldquo;Email&rdquo;. Comma-separated, and a
                size can carry as many as it needs.
              </p>
              <p className="mt-2">
                Tags filter the pickers in the builder, so prefer an existing tag over a new spelling of it.
              </p>
            </HelpTip>
          </span>
          <input
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            list="ad-size-tag-vocab"
            placeholder="Facebook, Display"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
          <datalist id="ad-size-tag-vocab">
            {allTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <button
          onClick={create}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-4 h-10 text-sm font-medium text-white transition-colors hover:bg-[var(--primary)]/90 disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
          Add size
        </button>
      </div>

      {/* Browse — search + tag filters over the whole library */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-56">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sizes…"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] py-2 pl-9 pr-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          />
        </div>
        <TagFilterChips facets={facets} selected={tagFilter} onChange={setTagFilter} />
        <span className="ml-auto text-xs text-[var(--muted-foreground)]">
          {shown.length} of {sizes.length} {sizes.length === 1 ? 'size' : 'sizes'}
        </span>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="glass-card rounded-2xl px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
          {sizes.length === 0
            ? 'No sizes yet — add the first one above.'
            : 'No sizes match that search or tag filter.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {shown.map((s) => {
            const editing = editId === s.id;
            return (
              <div key={s.id} className="glass-card flex items-start gap-3 rounded-2xl border border-[var(--border)] p-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--muted)]/40">
                  <RatioSwatch width={s.width} height={s.height} long={44} fill="var(--primary)" className="opacity-40" />
                </div>

                {editing ? (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Name"
                      className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                    />
                    <input
                      type="number"
                      value={editWidth}
                      onChange={(e) => setEditWidth(e.target.value)}
                      className="w-16 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-center text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                    />
                    <span className="text-[var(--muted-foreground)]">×</span>
                    <input
                      type="number"
                      value={editHeight}
                      onChange={(e) => setEditHeight(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(s.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                      className="w-16 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-center text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--foreground)]">{s.name}</div>
                    <div className="text-xs text-[var(--muted-foreground)]">
                      {s.width}×{s.height} · {aspectLabel(s.width, s.height)}
                    </div>

                    {/* Tags — click to add/remove; saved as soon as they change. */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {s.tags.map((tag) => (
                        <TagChip
                          key={tag}
                          tag={tag}
                          size="xs"
                          removable
                          onRemove={() => void saveTags(s, s.tags.filter((x) => x !== tag))}
                        />
                      ))}
                      <div className="relative" ref={tagFor === s.id ? tagRef : undefined}>
                        <button
                          onClick={() => setTagFor((v) => (v === s.id ? null : s.id))}
                          title="Add tag"
                          className="inline-flex items-center gap-0.5 rounded px-1.5 py-px text-[10px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--primary)]/5 hover:text-[var(--primary)]"
                        >
                          <PlusIcon className="h-2.5 w-2.5" />
                          {s.tags.length === 0 && <span>tag</span>}
                        </button>
                        {tagFor === s.id && (
                          <TagEditorPopover
                            allTags={Array.from(new Set([...allTags, ...s.tags]))}
                            currentTags={Object.fromEntries(
                              Array.from(new Set([...allTags, ...s.tags])).map((t) => [t, s.tags.includes(t) ? 'all' : 'none'] as const),
                            )}
                            onToggle={(tag) =>
                              void saveTags(s, s.tags.includes(tag) ? s.tags.filter((x) => x !== tag) : [...s.tags, tag])
                            }
                            onCreate={(tag) => saveTags(s, [...s.tags, tag])}
                            popoverRef={tagRef}
                          />
                        )}
                      </div>
                    </div>

                    <div className="mt-1.5 flex items-center gap-1.5">
                      <UserAvatar name={s.createdByName} email={s.createdByEmail} avatarUrl={s.createdByImage} size={18} />
                      <span className="truncate text-[11px] text-[var(--muted-foreground)]">
                        {s.createdByName || 'Someone'}
                        {s.createdAt ? ` · ${new Date(s.createdAt).toLocaleDateString()}` : ''}
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex flex-shrink-0 items-center gap-1">
                  {editing ? (
                    <>
                      <button
                        onClick={() => saveEdit(s.id)}
                        disabled={savingEdit}
                        title="Save"
                        className="rounded-md p-1.5 text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/10 disabled:opacity-50"
                      >
                        <CheckIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        title="Cancel"
                        className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEdit(s)}
                        title="Edit"
                        className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                      >
                        <PencilSquareIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => remove(s)}
                        title="Remove"
                        className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
