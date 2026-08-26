'use client';

/**
 * Unified "Insert" modal for the HTML landing-page editor.
 *
 * Two tabs:
 *  - Media: subaccount media library. List + search + drag-drop upload
 *    + rename + delete. Click a tile to insert an `<img>` tag at the
 *    Monaco cursor.
 *  - Forms: the subaccount's forms. Click a row to insert a
 *    `<div data-loomi-form="ID"></div>` tag at the cursor.
 *
 * The modal returns the HTML snippet to insert via `onInsert`; the
 * editor shell handles the actual Monaco edit.
 *
 * Account scope: `accountKey` filters both lists. The modal is
 * useless without it — bail with a friendly message if missing.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import {
  ArrowUpTrayIcon,
  CheckIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PhotoIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import type { FormSummary } from '@/lib/services/forms';

export type InsertEmbedTab = 'media' | 'forms';

export interface InsertEmbedModalProps {
  open: boolean;
  defaultTab?: InsertEmbedTab;
  accountKey: string | null;
  onClose: () => void;
  /** Called with the HTML snippet the user picked. The editor shell
   *  is responsible for inserting it at the Monaco cursor. */
  onInsert: (htmlSnippet: string) => void;
}

interface MediaFile {
  id: string;
  name: string;
  url: string;
  type: string;
  size?: number;
  thumbnailUrl?: string;
  /** Accessible alt text — used as the default `alt=` on insertion.
   *  Falls back to the filename minus extension when null. */
  altText?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

const swrFetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

export function InsertEmbedModal({
  open,
  defaultTab = 'media',
  accountKey,
  onClose,
  onInsert,
}: InsertEmbedModalProps) {
  const [mounted, setMounted] = React.useState(false);
  const [tab, setTab] = React.useState<InsertEmbedTab>(defaultTab);

  React.useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Re-sync tab whenever the modal is (re-)opened — so the "Insert
  // form" button always lands on the Forms tab even if the user last
  // closed it from the Media tab.
  React.useEffect(() => {
    if (open) setTab(defaultTab);
  }, [open, defaultTab]);

  React.useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[220] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="glass-modal w-[920px] max-w-full max-h-[88vh] flex flex-col overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Header tab={tab} onTabChange={setTab} onClose={onClose} />

        {!accountKey ? (
          <div className="flex-1 flex items-center justify-center p-12 text-sm text-[var(--muted-foreground)]">
            Select an account before inserting media or forms.
          </div>
        ) : tab === 'media' ? (
          <MediaTab accountKey={accountKey} onInsert={onInsert} onClose={onClose} />
        ) : (
          <FormsTab accountKey={accountKey} onInsert={onInsert} onClose={onClose} />
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Header (tabs + close) ──────────────────────────────────────────

function Header({
  tab,
  onTabChange,
  onClose,
}: {
  tab: InsertEmbedTab;
  onTabChange: (t: InsertEmbedTab) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-5 py-3 border-b border-[var(--border)]">
      <TabButton
        active={tab === 'media'}
        onClick={() => onTabChange('media')}
        icon={<PhotoIcon className="w-4 h-4" />}
        label="Media"
      />
      <TabButton
        active={tab === 'forms'}
        onClick={() => onTabChange('forms')}
        icon={<DocumentTextIcon className="w-4 h-4" />}
        label="Forms"
      />
      <div className="flex-1" />
      <button
        type="button"
        onClick={onClose}
        className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
        aria-label="Close"
      >
        <XMarkIcon className="w-5 h-5" />
      </button>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
        active
          ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Media tab ──────────────────────────────────────────────────────

function MediaTab({
  accountKey,
  onInsert,
  onClose,
}: {
  accountKey: string;
  onInsert: (snippet: string) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = React.useState<MediaFile[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [nextCursor, setNextCursor] = React.useState<string | undefined>();
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [editingAltId, setEditingAltId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const loadMedia = React.useCallback(
    async (cursor?: string) => {
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '50', accountKey });
        if (cursor) params.set('cursor', cursor);
        const res = await fetch(`/api/media?${params}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
        const incoming: MediaFile[] = data.files || [];
        setFiles((prev) => (cursor ? [...prev, ...incoming] : incoming));
        setNextCursor(data?.nextCursor || undefined);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load media');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [accountKey],
  );

  React.useEffect(() => {
    void loadMedia();
  }, [loadMedia]);

  const handleUpload = React.useCallback(
    async (fileList: FileList | null) => {
      if (!fileList?.length) return;
      setUploading(true);
      try {
        const uploaded: MediaFile[] = [];
        for (const file of Array.from(fileList)) {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('accountKey', accountKey);
          const res = await fetch('/api/media', { method: 'POST', body: formData });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status})`);
          if (data?.file) uploaded.push(data.file);
        }
        if (uploaded.length) {
          setFiles((prev) => [...uploaded, ...prev]);
          toast.success(`Uploaded ${uploaded.length} file${uploaded.length > 1 ? 's' : ''}`);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [accountKey],
  );

  const handleDelete = React.useCallback(async (file: MediaFile) => {
    if (!window.confirm(`Delete "${file.name}"? This can't be undone.`)) return;
    setDeletingId(file.id);
    try {
      const res = await fetch(`/api/media/${file.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Delete failed (${res.status})`);
      }
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      toast.success('Deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }, []);

  const handleRename = React.useCallback(async (file: MediaFile, nextName: string) => {
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === file.name) {
      setRenamingId(null);
      return;
    }
    try {
      const res = await fetch(`/api/media/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Rename failed (${res.status})`);
      setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, name: trimmed } : f)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setRenamingId(null);
    }
  }, []);

  const handleEditAlt = React.useCallback(async (file: MediaFile, nextAlt: string) => {
    const trimmed = nextAlt.trim();
    // No-op if unchanged. Treat empty string as "clear" (null), matches
    // the API's contract — pass null to clear, omit to leave alone.
    const next = trimmed.length === 0 ? null : trimmed;
    const current = file.altText ?? null;
    if (next === current) {
      setEditingAltId(null);
      return;
    }
    try {
      const res = await fetch(`/api/media/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ altText: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Update failed (${res.status})`);
      setFiles((prev) =>
        prev.map((f) => (f.id === file.id ? { ...f, altText: next } : f)),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setEditingAltId(null);
    }
  }, []);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, search]);

  const handlePick = (file: MediaFile) => {
    // Stored alt text wins; fall back to stripped filename so the
    // user never gets a blank alt (failing accessibility checks).
    const alt = file.altText?.trim() || stripExtension(file.name);
    onInsert(`<img src="${escapeAttr(file.url)}" alt="${escapeAttr(alt)}" />\n`);
    onClose();
  };

  return (
    <>
      {/* Search + upload row */}
      <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-1.5 outline-none focus:border-[var(--primary)]"
            placeholder="Search media…"
          />
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--accent)] disabled:opacity-50 transition-colors"
        >
          <ArrowUpTrayIcon className={`w-4 h-4 ${uploading ? 'animate-bounce' : ''}`} />
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => handleUpload(e.target.files)}
          className="hidden"
        />
      </div>

      {/* Grid (also a drop target) */}
      <div
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleUpload(e.dataTransfer.files);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        className={`flex-1 overflow-y-auto p-4 transition-colors ${
          dragOver ? 'bg-[var(--primary)]/5' : ''
        }`}
      >
        {loading ? (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-square bg-[var(--muted)] rounded-lg" />
                <div className="h-2.5 bg-[var(--muted)] rounded w-3/4 mt-2" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<PhotoIcon className="w-10 h-10 opacity-30" />}
            title={files.length === 0 ? 'No media yet' : 'No matches'}
            hint={files.length === 0 ? 'Drop an image above to upload.' : undefined}
          />
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {filtered.map((f) => (
              <MediaTile
                key={f.id}
                file={f}
                isRenaming={renamingId === f.id}
                isEditingAlt={editingAltId === f.id}
                isDeleting={deletingId === f.id}
                onPick={() => handlePick(f)}
                onStartRename={() => {
                  setEditingAltId(null);
                  setRenamingId(f.id);
                }}
                onCancelRename={() => setRenamingId(null)}
                onCommitRename={(name) => handleRename(f, name)}
                onStartEditAlt={() => {
                  setRenamingId(null);
                  setEditingAltId(f.id);
                }}
                onCancelEditAlt={() => setEditingAltId(null)}
                onCommitEditAlt={(alt) => handleEditAlt(f, alt)}
                onDelete={() => handleDelete(f)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)]">
        <p className="text-xs text-[var(--muted-foreground)]">
          {loading ? 'Loading…' : `${filtered.length} file${filtered.length !== 1 ? 's' : ''}`}
        </p>
        {nextCursor && !loading && (
          <button
            type="button"
            onClick={() => void loadMedia(nextCursor)}
            disabled={loadingMore}
            className="text-xs font-medium text-[var(--primary)] hover:opacity-80 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </>
  );
}

function MediaTile({
  file,
  isRenaming,
  isEditingAlt,
  isDeleting,
  onPick,
  onStartRename,
  onCancelRename,
  onCommitRename,
  onStartEditAlt,
  onCancelEditAlt,
  onCommitEditAlt,
  onDelete,
}: {
  file: MediaFile;
  isRenaming: boolean;
  isEditingAlt: boolean;
  isDeleting: boolean;
  onPick: () => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onCommitRename: (name: string) => void;
  onStartEditAlt: () => void;
  onCancelEditAlt: () => void;
  onCommitEditAlt: (alt: string) => void;
  onDelete: () => void;
}) {
  const [nameDraft, setNameDraft] = React.useState(file.name);
  const [altDraft, setAltDraft] = React.useState(file.altText ?? '');
  React.useEffect(() => {
    if (isRenaming) setNameDraft(file.name);
  }, [isRenaming, file.name]);
  React.useEffect(() => {
    if (isEditingAlt) setAltDraft(file.altText ?? '');
  }, [isEditingAlt, file.altText]);

  const isImage =
    file.type?.startsWith('image') ||
    /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.url || '');
  const hasAlt = !!file.altText?.trim();
  const isEditing = isRenaming || isEditingAlt;

  return (
    <div
      className={`relative rounded-lg overflow-hidden border border-[var(--border)] group transition-all ${
        isDeleting ? 'opacity-50' : 'hover:border-[var(--primary)] hover:ring-1 hover:ring-[var(--primary)]/30'
      }`}
    >
      <button
        type="button"
        onClick={onPick}
        disabled={isEditing || isDeleting}
        className="block w-full text-left disabled:cursor-default"
        title={isEditing ? undefined : `Insert ${file.name}`}
      >
        <div className="aspect-square bg-[var(--muted)] overflow-hidden">
          {/* Thumbnail only, never the original. See media/page.tsx. */}
          {isImage && file.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={file.thumbnailUrl}
              alt={file.altText || file.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
              loading="lazy"
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <PhotoIcon className="w-6 h-6 text-[var(--muted-foreground)] opacity-30" />
            </div>
          )}
        </div>
      </button>

      <div className="px-2 py-1.5 bg-[var(--card)] space-y-0.5">
        {/* Filename row */}
        {isRenaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onCommitRename(nameDraft);
            }}
            className="flex items-center gap-1"
          >
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onCancelRename();
              }}
              onBlur={() => onCommitRename(nameDraft)}
              className="flex-1 min-w-0 text-[11px] bg-[var(--input)] border border-[var(--border)] rounded px-1.5 py-0.5 outline-none focus:border-[var(--primary)]"
              aria-label="Filename"
            />
            <button
              type="submit"
              className="p-0.5 text-[var(--primary)]"
              aria-label="Save filename"
            >
              <CheckIcon className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : (
          <p
            className="text-[11px] truncate text-[var(--muted-foreground)]"
            title={file.name}
          >
            {file.name}
          </p>
        )}

        {/* Alt-text row */}
        {isEditingAlt ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onCommitEditAlt(altDraft);
            }}
            className="flex items-center gap-1"
          >
            <input
              autoFocus
              value={altDraft}
              onChange={(e) => setAltDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onCancelEditAlt();
              }}
              onBlur={() => onCommitEditAlt(altDraft)}
              placeholder="Describe this image…"
              className="flex-1 min-w-0 text-[10px] bg-[var(--input)] border border-[var(--border)] rounded px-1.5 py-0.5 outline-none focus:border-[var(--primary)]"
              aria-label="Alt text"
            />
            <button
              type="submit"
              className="p-0.5 text-[var(--primary)]"
              aria-label="Save alt text"
            >
              <CheckIcon className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : (
          <p
            className={`text-[10px] truncate ${
              hasAlt ? 'text-[var(--muted-foreground)]/80' : 'italic text-[var(--muted-foreground)]/50'
            }`}
            title={file.altText || 'No alt text — click the alt icon to add one'}
          >
            {hasAlt ? `alt: ${file.altText}` : 'alt: —'}
          </p>
        )}
      </div>

      {/* Action overlay (visible on hover when not in any edit mode) */}
      {!isEditing && !isDeleting && (
        <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <TileActionButton
            label={hasAlt ? 'Edit alt text' : 'Add alt text'}
            icon={
              <span
                className={`text-[9px] font-bold leading-none ${
                  hasAlt ? '' : 'text-rose-400'
                }`}
                aria-hidden="true"
              >
                ALT
              </span>
            }
            onClick={(e) => {
              e.stopPropagation();
              onStartEditAlt();
            }}
          />
          <TileActionButton
            label="Rename"
            icon={<PencilSquareIcon className="w-3.5 h-3.5" />}
            onClick={(e) => {
              e.stopPropagation();
              onStartRename();
            }}
          />
          <TileActionButton
            label="Delete"
            icon={<TrashIcon className="w-3.5 h-3.5 text-rose-400" />}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          />
        </div>
      )}
    </div>
  );
}

function TileActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center w-6 h-6 rounded bg-[var(--card)]/90 backdrop-blur-sm border border-[var(--border)] hover:bg-[var(--muted)] transition-colors"
    >
      {icon}
    </button>
  );
}

// ── Forms tab ──────────────────────────────────────────────────────

function FormsTab({
  accountKey,
  onInsert,
  onClose,
}: {
  accountKey: string;
  onInsert: (snippet: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = React.useState('');
  const { data, isLoading, error } = useSWR<{ forms: FormSummary[] }>(
    `/api/forms?pageSize=200&accountKey=${encodeURIComponent(accountKey)}`,
    swrFetcher,
  );
  const forms = data?.forms ?? [];

  const filtered = React.useMemo(() => {
    if (!search.trim()) return forms;
    const q = search.toLowerCase();
    return forms.filter(
      (f) =>
        (f.name ?? '').toLowerCase().includes(q) ||
        (f.slug ?? '').toLowerCase().includes(q),
    );
  }, [forms, search]);

  const handlePick = (formId: string) => {
    onInsert(`<div data-loomi-form="${escapeAttr(formId)}"></div>\n`);
    onClose();
  };

  return (
    <>
      <div className="px-5 py-3 border-b border-[var(--border)]">
        <div className="relative max-w-sm">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-1.5 outline-none focus:border-[var(--primary)]"
            placeholder="Search forms…"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 bg-[var(--muted)] rounded-lg animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            icon={<DocumentTextIcon className="w-10 h-10 opacity-30" />}
            title="Could not load forms"
            hint="Check your connection and retry."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<DocumentTextIcon className="w-10 h-10 opacity-30" />}
            title={forms.length === 0 ? 'No forms yet' : 'No matches'}
            hint={
              forms.length === 0
                ? 'Create one under Websites → Forms first.'
                : undefined
            }
          />
        ) : (
          <ul className="space-y-1.5">
            {filtered.map((form) => (
              <li key={form.id}>
                <button
                  type="button"
                  onClick={() => handlePick(form.id)}
                  className="w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--accent)] transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {form.name || 'Untitled'}
                    </p>
                    <p className="text-[11px] text-[var(--muted-foreground)] truncate">
                      /{form.slug}
                    </p>
                  </div>
                  <span className="text-[11px] text-[var(--muted-foreground)] flex-shrink-0">
                    {form.status === 'published' ? 'Published' : 'Draft'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-5 py-3 border-t border-[var(--border)]">
        <p className="text-xs text-[var(--muted-foreground)]">
          {isLoading ? 'Loading…' : `${filtered.length} form${filtered.length !== 1 ? 's' : ''}`}
        </p>
      </div>
    </>
  );
}

// ── Shared ─────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="text-center py-12 text-[var(--muted-foreground)]">
      <div className="flex justify-center mb-2">{icon}</div>
      <p className="text-sm">{title}</p>
      {hint && <p className="text-xs mt-1 opacity-60">{hint}</p>}
    </div>
  );
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
