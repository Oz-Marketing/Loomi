'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  PlusIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  TrashIcon,
  SparklesIcon,
  MagnifyingGlassIcon,
  MegaphoneIcon,
  LockClosedIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import PrimaryButton from '@/components/primary-button';
import { Tooltip } from '@/app/app/tools/_shared/Tooltip';
import { useAccount } from '@/contexts/account-context';
import {
  type ChangelogEntry,
  type EntryType,
  type ChangelogAudience,
  TYPE_META,
  ENTRY_TYPES,
  AUDIENCES,
  AUDIENCE_META,
  formatChangelogDate,
} from '@/lib/changelog';

// ── Filter types ──

type FilterType = 'all' | EntryType;
/** Staff-only view filter — clients never see anything but published entries. */
type StatusFilter = 'all' | 'draft' | 'published';

// ── Entry Form (create / edit) ──

function EntryForm({
  title,
  setTitle,
  content,
  setContent,
  type,
  setType,
  audience,
  setAudience,
  onSubmit,
  onCancel,
  submitLabel,
  saving,
}: {
  title: string;
  setTitle: (v: string) => void;
  content: string;
  setContent: (v: string) => void;
  type: EntryType;
  setType: (v: EntryType) => void;
  audience: ChangelogAudience;
  setAudience: (v: ChangelogAudience) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  saving: boolean;
}) {
  return (
    <div className="glass-card rounded-xl p-5 space-y-3 animate-fade-in-up">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What changed?"
        className="w-full text-sm font-medium bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
        autoFocus
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Describe the change..."
        rows={4}
        className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] resize-none"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            {ENTRY_TYPES.map((t) => {
              const meta = TYPE_META[t];
              const isSelected = type === t;
              return (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className="px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors"
                  style={{
                    backgroundColor: isSelected ? meta.bg : 'var(--muted)',
                    color: isSelected ? meta.color : 'var(--muted-foreground)',
                  }}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>

          {/* Audience — who this entry reaches, and who gets notified about it */}
          <div className="flex items-center gap-1.5 border-l border-[var(--border)] pl-3">
            <Tooltip
              label={
                <span className="block max-w-[16rem] text-left">
                  {AUDIENCES.map((a) => (
                    <span key={a} className="mb-1 block last:mb-0">
                      <strong>{AUDIENCE_META[a].label}</strong> — {AUDIENCE_META[a].description}
                    </span>
                  ))}
                </span>
              }
            >
              <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                Audience
                <QuestionMarkCircleIcon className="h-3 w-3" />
              </span>
            </Tooltip>
            {AUDIENCES.map((a) => {
              const isSelected = audience === a;
              return (
                <button
                  key={a}
                  onClick={() => setAudience(a)}
                  className="rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors"
                  style={{
                    backgroundColor: isSelected ? 'var(--primary)' : 'var(--muted)',
                    color: isSelected ? 'white' : 'var(--muted-foreground)',
                  }}
                >
                  {AUDIENCE_META[a].label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
          >
            Cancel
          </button>
          <PrimaryButton
            onClick={onSubmit}
            disabled={saving || !title.trim() || !content.trim()}
          >
            {saving ? 'Saving...' : submitLabel}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ── Page Component ──

export default function ChangelogPage() {
  const { userRole } = useAccount();
  const canEdit =
    userRole === 'developer' || userRole === 'admin' || userRole === 'super_admin';

  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filter, setFilter] = useState<FilterType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [createType, setCreateType] = useState<EntryType>('improvement');
  const [createAudience, setCreateAudience] = useState<ChangelogAudience>('everyone');
  const [saving, setSaving] = useState(false);

  // Edit form
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editType, setEditType] = useState<EntryType>('improvement');
  const [editAudience, setEditAudience] = useState<ChangelogAudience>('everyone');
  const [publishing, setPublishing] = useState<string | null>(null);

  // Menu
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Data Loading ──

  const loadEntries = useCallback(async () => {
    try {
      const res = await fetch('/api/changelog');
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // Mark as seen — against the newest PUBLISHED entry. Drafts are only visible
  // to staff and aren't announced, so letting one clear the dot would hide the
  // real release from the person who filed it.
  useEffect(() => {
    const newest = entries.find((e) => e.status === 'published');
    if (newest) {
      localStorage.setItem('loomi-changelog-seen', newest.publishedAt);
    }
  }, [entries]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // ── Filtered entries ──

  const draftCount = useMemo(
    () => entries.filter((e) => e.status === 'draft').length,
    [entries],
  );

  const filteredEntries = useMemo(() => {
    let result = entries;

    if (statusFilter !== 'all') {
      result = result.filter((e) => e.status === statusFilter);
    }

    if (filter !== 'all') {
      result = result.filter((e) => e.type === filter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q) ||
          (e.createdBy || '').toLowerCase().includes(q),
      );
    }

    return result;
  }, [entries, filter, statusFilter, search]);

  // ── Type counts ──

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entries.length };
    for (const t of ENTRY_TYPES) {
      counts[t] = entries.filter((e) => e.type === t).length;
    }
    return counts;
  }, [entries]);

  // ── CRUD Handlers ──

  /** `status` decides whether creating also announces it. */
  const handleCreate = async (status: 'published' | 'draft') => {
    if (!createTitle.trim() || !createContent.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/changelog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: createTitle,
          content: createContent,
          type: createType,
          audience: createAudience,
          status,
        }),
      });
      if (res.ok) {
        toast.success(status === 'draft' ? 'Draft saved' : 'Entry published');
        setShowCreate(false);
        setCreateTitle('');
        setCreateContent('');
        setCreateType('improvement');
        setCreateAudience('everyone');
        await loadEntries();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to create');
      }
    } catch {
      toast.error('Failed to create entry');
    }
    setSaving(false);
  };

  const handleUpdate = async (id: string) => {
    if (!editTitle.trim() || !editContent.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/changelog/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          content: editContent,
          type: editType,
          audience: editAudience,
        }),
      });
      if (res.ok) {
        toast.success('Entry updated');
        setEditId(null);
        await loadEntries();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to update');
      }
    } catch {
      toast.error('Failed to update entry');
    }
    setSaving(false);
  };

  /**
   * Publish a draft. This is the point of no return — it makes the entry
   * visible and sends the notification — so it confirms first, naming who it
   * reaches.
   */
  const handlePublish = async (entry: ChangelogEntry) => {
    const reach =
      entry.audience === 'staff'
        ? 'admins and developers'
        : 'everyone, including clients';
    if (
      !window.confirm(
        `Publish "${entry.title}"?\n\nIt becomes visible to ${reach}, and anyone with product-update notifications on will be told. This can't be unsent.`,
      )
    ) {
      return;
    }

    setPublishing(entry.id);
    setMenuOpen(null);
    try {
      const res = await fetch(`/api/changelog/${entry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish: true }),
      });
      if (res.ok) {
        toast.success('Published — notifications sent');
        await loadEntries();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to publish');
      }
    } catch {
      toast.error('Failed to publish entry');
    }
    setPublishing(null);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/changelog/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Entry deleted');
        setMenuOpen(null);
        await loadEntries();
      } else {
        toast.error('Failed to delete');
      }
    } catch {
      toast.error('Failed to delete entry');
    }
  };

  const startEdit = (entry: ChangelogEntry) => {
    setEditId(entry.id);
    setEditTitle(entry.title);
    setEditContent(entry.content);
    setEditType(entry.type as EntryType);
    setEditAudience(entry.audience === 'staff' ? 'staff' : 'everyone');
    setMenuOpen(null);
  };

  // ── Render ──

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Changelog</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {filteredEntries.length} update{filteredEntries.length !== 1 ? 's' : ''}
            {filter !== 'all' || statusFilter !== 'all' || search ? ` found` : ''}
            {canEdit && draftCount > 0 && (
              <>
                {' · '}
                <button
                  onClick={() => setStatusFilter('draft')}
                  className="font-medium text-[var(--primary)] hover:underline"
                >
                  {draftCount} draft{draftCount !== 1 ? 's' : ''} awaiting publish
                </button>
              </>
            )}
          </p>
        </div>
        {canEdit && !showCreate && (
          <PrimaryButton
            onClick={() => {
              setShowCreate(true);
              setEditId(null);
            }}
          >
            <PlusIcon className="w-4 h-4" /> Add Entry
          </PrimaryButton>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex items-center gap-1.5">
          {/* All filter */}
          <button
            onClick={() => setFilter('all')}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
            style={{
              backgroundColor:
                filter === 'all' ? 'var(--primary)' : 'var(--muted)',
              color: filter === 'all' ? 'white' : 'var(--muted-foreground)',
            }}
          >
            All{' '}
            <span className="ml-1 opacity-70">{typeCounts.all}</span>
          </button>

          {/* Type filters */}
          {ENTRY_TYPES.map((t) => {
            const meta = TYPE_META[t];
            const isActive = filter === t;
            return (
              <button
                key={t}
                onClick={() => setFilter(isActive ? 'all' : t)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                style={{
                  backgroundColor: isActive ? meta.bg : 'var(--muted)',
                  color: isActive ? meta.color : 'var(--muted-foreground)',
                }}
              >
                <meta.Icon className="w-3 h-3" />
                {meta.label}
                <span className="ml-0.5 opacity-70">{typeCounts[t]}</span>
              </button>
            );
          })}
        </div>

        {/* Draft / published — staff only; clients are never served a draft */}
        {canEdit && (
          <div className="flex items-center gap-1.5 border-l border-[var(--border)] pl-3">
            {(
              [
                { key: 'all', label: 'All' },
                { key: 'draft', label: 'Drafts', count: draftCount },
                { key: 'published', label: 'Published' },
              ] as Array<{ key: StatusFilter; label: string; count?: number }>
            ).map(({ key, label, count }) => {
              const isActive = statusFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: isActive ? 'var(--primary)' : 'var(--muted)',
                    color: isActive ? 'white' : 'var(--muted-foreground)',
                  }}
                >
                  {label}
                  {count !== undefined && count > 0 && (
                    <span className="ml-1 opacity-70">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Search */}
        <div className="relative ml-auto">
          <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-48 pl-8 pr-3 py-1.5 text-xs bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-4">
          <EntryForm
            title={createTitle}
            setTitle={setCreateTitle}
            content={createContent}
            setContent={setCreateContent}
            type={createType}
            setType={setCreateType}
            audience={createAudience}
            setAudience={setCreateAudience}
            onSubmit={() => handleCreate('published')}
            onCancel={() => {
              setShowCreate(false);
              setCreateTitle('');
              setCreateContent('');
            }}
            submitLabel="Publish"
            saving={saving}
          />
          <div className="mt-2 flex items-center justify-end gap-3">
            <button
              onClick={() => handleCreate('draft')}
              disabled={saving || !createTitle.trim() || !createContent.trim()}
              className="text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
            >
              Save as draft instead
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && entries.length === 0 && (
        <div className="text-center py-20 text-[var(--muted-foreground)]">
          <SparklesIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium mb-1">No updates yet</p>
          <p className="text-xs">
            Changelog entries will appear here as changes are made.
          </p>
        </div>
      )}

      {/* No results for current filter */}
      {!loading && entries.length > 0 && filteredEntries.length === 0 && (
        <div className="text-center py-16 text-[var(--muted-foreground)]">
          <p className="text-sm">No entries were found.</p>
          <p className="text-xs mt-1">
            Try a different filter or clear your search.
          </p>
        </div>
      )}

      {/* Entry list */}
      {!loading && (
        <div className="space-y-3">
          {filteredEntries.map((entry) => {
            const meta =
              TYPE_META[entry.type as EntryType] || TYPE_META.improvement;
            const isEditing = editId === entry.id;
            const isMenuOpen = menuOpen === entry.id;

            if (isEditing) {
              return (
                <EntryForm
                  key={entry.id}
                  title={editTitle}
                  setTitle={setEditTitle}
                  content={editContent}
                  setContent={setEditContent}
                  type={editType}
                  setType={setEditType}
                  audience={editAudience}
                  setAudience={setEditAudience}
                  onSubmit={() => handleUpdate(entry.id)}
                  onCancel={() => setEditId(null)}
                  submitLabel="Update"
                  saving={saving}
                />
              );
            }

            const isDraft = entry.status === 'draft';

            return (
              <div
                key={entry.id}
                className="glass-card rounded-xl p-5 group animate-fade-in-up"
                // Drafts are a working state, not a published record — dim them
                // so a shelf of them never reads like shipped history.
                style={isDraft ? { opacity: 0.75 } : undefined}
              >
                {/* Type badge + date + menu */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                      style={{ backgroundColor: meta.bg, color: meta.color }}
                    >
                      <meta.Icon className="w-3 h-3" />
                      {meta.label}
                    </span>

                    {isDraft && (
                      <Tooltip label="Not visible to anyone else, and no notification has been sent.">
                        <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                          Draft
                        </span>
                      </Tooltip>
                    )}

                    {entry.audience === 'staff' && (
                      <Tooltip label="Staff only — clients can't see this entry and aren't notified about it.">
                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                          <LockClosedIcon className="h-3 w-3" />
                          Staff
                        </span>
                      </Tooltip>
                    )}

                    <span className="text-[10px] text-[var(--muted-foreground)]">
                      {isDraft ? 'Not published' : formatChangelogDate(entry.publishedAt)}
                    </span>

                    {entry.sourceKey?.startsWith('pr:') && (
                      <Tooltip label={`Filed automatically from pull request #${entry.sourceKey.slice(3).split('#')[0]}.`}>
                        <span className="text-[10px] text-[var(--muted-foreground)] opacity-60">
                          #{entry.sourceKey.slice(3).split('#')[0]}
                        </span>
                      </Tooltip>
                    )}
                  </div>

                  {canEdit && (
                    <div
                      className="relative"
                      ref={isMenuOpen ? menuRef : undefined}
                    >
                      <button
                        onClick={() =>
                          setMenuOpen(isMenuOpen ? null : entry.id)
                        }
                        // Always visible on a draft: it's the only way to reach
                        // Publish, and a hover-only control makes the action
                        // look like it doesn't exist.
                        className={`p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors group-hover:opacity-100 ${
                          isDraft ? 'opacity-100' : 'opacity-0'
                        }`}
                      >
                        <EllipsisVerticalIcon className="w-4 h-4" />
                      </button>
                      {isMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 z-50 w-40 glass-dropdown">
                          {isDraft && (
                            <button
                              onClick={() => handlePublish(entry)}
                              disabled={publishing === entry.id}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
                            >
                              <MegaphoneIcon className="w-3.5 h-3.5" />
                              {publishing === entry.id ? 'Publishing…' : 'Publish & notify'}
                            </button>
                          )}
                          <button
                            onClick={() => startEdit(entry)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                          >
                            <PencilIcon className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button
                            onClick={() => handleDelete(entry.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <TrashIcon className="w-3.5 h-3.5" /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Title + content */}
                <h3 className="text-sm font-semibold mb-1">{entry.title}</h3>
                <p className="text-xs text-[var(--muted-foreground)] leading-relaxed whitespace-pre-wrap">
                  {entry.content}
                </p>

                {/* Author */}
                {entry.createdBy && (
                  <p className="text-[10px] text-[var(--muted-foreground)] mt-2 opacity-60">
                    — {entry.createdBy}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
