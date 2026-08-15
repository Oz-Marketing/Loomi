'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  XMarkIcon,
  PlusIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  TrashIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { useAccount } from '@/contexts/account-context';
import {
  type ChangelogEntry,
  type EntryType,
  TYPE_META,
  ENTRY_TYPES,
  formatChangelogDate,
} from '@/lib/changelog';

// ── Component ──

interface ChangelogPanelProps {
  onClose: () => void;
}

export function ChangelogPanel({ onClose }: ChangelogPanelProps) {
  const { userRole } = useAccount();
  const canEdit = userRole === 'developer' || userRole === 'admin';

  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [createType, setCreateType] = useState<EntryType>('improvement');
  const [saving, setSaving] = useState(false);

  // Edit form
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editType, setEditType] = useState<EntryType>('improvement');

  // Menu
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Data Loading ──

  const loadEntries = useCallback(async () => {
    try {
      const res = await fetch('/api/changelog');
      if (res.ok) {
        const data = await res.json();
        // Published only. The API hands staff their drafts too, but this is the
        // "what's new" popover — unannounced work-in-progress belongs on the
        // full /changelog page where it can be reviewed and published.
        const all: ChangelogEntry[] = data.entries || [];
        setEntries(all.filter((e) => e.status === 'published'));
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // Mark as seen
  useEffect(() => {
    if (entries.length > 0) {
      localStorage.setItem('loomi-changelog-seen', entries[0].publishedAt);
    }
  }, [entries]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Handlers ──

  const handleCreate = async () => {
    if (!createTitle.trim() || !createContent.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/changelog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: createTitle, content: createContent, type: createType }),
      });
      if (res.ok) {
        toast.success('Entry created');
        setShowCreate(false);
        setCreateTitle('');
        setCreateContent('');
        setCreateType('improvement');
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
        body: JSON.stringify({ title: editTitle, content: editContent, type: editType }),
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
    setMenuOpen(null);
  };

  // ── Entry Form (shared between create and edit) ──

  const EntryForm = ({
    title,
    setTitle,
    content,
    setContent,
    type,
    setType,
    onSubmit,
    onCancel,
    submitLabel,
  }: {
    title: string;
    setTitle: (v: string) => void;
    content: string;
    setContent: (v: string) => void;
    type: EntryType;
    setType: (v: EntryType) => void;
    onSubmit: () => void;
    onCancel: () => void;
    submitLabel: string;
  }) => (
    <div className="glass-card rounded-xl p-4 space-y-3 animate-fade-in-up">
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
        rows={3}
        className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] resize-none"
      />
      <div className="flex items-center justify-between">
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
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={saving || !title.trim() || !content.trim()}
            className="px-3 py-1.5 text-xs font-medium bg-[var(--primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Saving...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );

  // ── Render ──

  return (
    <div className="fixed inset-0 z-50 animate-overlay-in" onClick={onClose}>
      <div
        ref={panelRef}
        className="glass-panel fixed right-3 top-3 bottom-3 w-[420px] rounded-2xl flex flex-col animate-slide-in-right overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold">Changelog</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-[10px] text-[var(--muted-foreground)]">
                {entries.length} update{entries.length !== 1 ? 's' : ''}
              </p>
              <Link
                href="/changelog"
                onClick={onClose}
                className="text-[10px] text-[var(--primary)] hover:underline"
              >
                View all
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && !showCreate && (
              <button
                onClick={() => { setShowCreate(true); setEditId(null); }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[var(--primary)] text-white rounded-lg hover:opacity-90 transition-opacity"
              >
                <PlusIcon className="w-3.5 h-3.5" /> New
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Create form */}
          {showCreate && (
            <EntryForm
              title={createTitle}
              setTitle={setCreateTitle}
              content={createContent}
              setContent={setCreateContent}
              type={createType}
              setType={setCreateType}
              onSubmit={handleCreate}
              onCancel={() => { setShowCreate(false); setCreateTitle(''); setCreateContent(''); }}
              submitLabel="Create"
            />
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Empty state */}
          {!loading && entries.length === 0 && (
            <div className="text-center py-12 text-[var(--muted-foreground)]">
              <SparklesIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium mb-1">No updates yet</p>
              <p className="text-xs">Changelog entries will appear here as changes are made.</p>
            </div>
          )}

          {/* Entries */}
          {!loading && entries.map((entry) => {
            const meta = TYPE_META[entry.type as EntryType] || TYPE_META.improvement;
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
                  onSubmit={() => handleUpdate(entry.id)}
                  onCancel={() => setEditId(null)}
                  submitLabel="Update"
                />
              );
            }

            return (
              <div key={entry.id} className="glass-card rounded-xl p-4 group animate-fade-in-up">
                {/* Type badge + date + menu */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                      style={{ backgroundColor: meta.bg, color: meta.color }}
                    >
                      <meta.Icon className="w-3 h-3" />
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-[var(--muted-foreground)]">
                      {formatChangelogDate(entry.publishedAt)}
                    </span>
                  </div>

                  {canEdit && (
                    <div className="relative" ref={isMenuOpen ? menuRef : undefined}>
                      <button
                        onClick={() => setMenuOpen(isMenuOpen ? null : entry.id)}
                        className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <EllipsisVerticalIcon className="w-4 h-4" />
                      </button>
                      {isMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 z-50 w-32 glass-dropdown">
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
      </div>
    </div>
  );
}
