'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  PhotoIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  ArrowUpTrayIcon,
  FolderIcon,
  FolderPlusIcon,
  ChevronRightIcon,
  PencilIcon,
  TrashIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { MEDIA_CATEGORIES } from '@/lib/media-categories';

// ── Types ──

interface MediaFile {
  id: string;
  name: string;
  url: string;
  type: string;
  size?: number;
  thumbnailUrl?: string;
  /** Accessible alt text editable elsewhere in the library. */
  altText?: string | null;
  /** Library category (general/brand/texture/ad-creative/oem). */
  category?: string | null;
  /** Folder the asset lives in (null = the scope root). */
  folderId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

/** A read-only branding asset surfaced in the picker (managed in Branding
 *  settings — the single source of truth — so it isn't editable here). */
export interface BrandingMediaItem {
  label: string;
  url: string;
}

const BRANDING_VIEW = '__branding__';

export interface MediaPickerModalProps {
  accountKey?: string;
  /** Fired when the user clicks a media tile. First arg = URL (back-compat);
   *  second = the full MediaFile for callers that want altText/etc. */
  onSelect: (url: string, file?: MediaFile) => void;
  onClose: () => void;
  fullScreen?: boolean;
  /** Show a category filter bar. Opt-in so existing pickers are unchanged. */
  showCategories?: boolean;
  /** Initial active category filter (a `MediaCategory` value). Undefined = All. */
  category?: string;
  /** Category to tag uploads with. Defaults to the active filter, then General. */
  uploadCategory?: string;
  /** Enable the folder system (breadcrumb, folder tiles, create/rename/delete,
   *  drag-to-move, upload-into-folder). Opt-in. */
  showFolders?: boolean;
  /** Read-only branding assets (e.g. the account's logo variants) surfaced under
   *  a "Branding" folder at the root. Selectable but not editable here. */
  brandingMedia?: BrandingMediaItem[];
}

// ── Component ──

export function MediaPickerModal({
  accountKey,
  onSelect,
  onClose,
  fullScreen = false,
  showCategories = false,
  category,
  uploadCategory,
  showFolders = false,
  brandingMedia,
}: MediaPickerModalProps) {
  const [mounted, setMounted] = useState(false);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | undefined>(category);
  // Folder state.
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null); // null = root; BRANDING_VIEW = branding
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dragAssetId, setDragAssetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const inBranding = currentFolderId === BRANDING_VIEW;
  const folderParam = currentFolderId === null ? 'root' : currentFolderId;

  // ── Fetch media ──
  const loadMedia = useCallback(async (cursor?: string) => {
    if (inBranding) { setFiles([]); setLoading(false); setNextCursor(undefined); return; }
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (accountKey) params.set('accountKey', accountKey);
      if (cursor) params.set('cursor', cursor);
      if (showCategories && activeCategory) params.set('category', activeCategory);
      if (showFolders) params.set('folder', folderParam);
      const res = await fetch(`/api/media?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as Record<string, string>)?.error || `Error ${res.status}`);
      const newFiles: MediaFile[] = data.files || [];
      setFiles((prev) => (cursor ? [...prev, ...newFiles] : newFiles));
      setNextCursor((data as { nextCursor?: string }).nextCursor || undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load media');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [accountKey, showCategories, activeCategory, showFolders, folderParam, inBranding]);

  useEffect(() => { loadMedia(); }, [loadMedia]);

  // ── Fetch folders ──
  const loadFolders = useCallback(async () => {
    if (!showFolders) return;
    try {
      const params = new URLSearchParams();
      if (accountKey) params.set('accountKey', accountKey);
      const res = await fetch(`/api/media/folders?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setFolders((data.folders as Folder[]) || []);
    } catch {
      /* folders are best-effort; the flat library still works */
    }
  }, [showFolders, accountKey]);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  // ── Upload (into the current folder) ──
  const handleUpload = useCallback(async (fileList: FileList | null) => {
    if (!fileList?.length || inBranding) return;
    setUploading(true);
    try {
      const uploaded: MediaFile[] = [];
      for (const file of Array.from(fileList)) {
        const formData = new FormData();
        formData.append('file', file);
        if (accountKey) formData.append('accountKey', accountKey);
        formData.append('category', uploadCategory || activeCategory || 'general');
        if (showFolders && currentFolderId) formData.append('folderId', currentFolderId);
        const res = await fetch('/api/media', { method: 'POST', body: formData });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as Record<string, string>)?.error || `Upload failed (${res.status})`);
        if ((data as { file?: MediaFile }).file) uploaded.push((data as { file: MediaFile }).file);
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
  }, [accountKey, uploadCategory, activeCategory, showFolders, currentFolderId, inBranding]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  }, [handleUpload]);

  // ── Folder ops ──
  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) { setCreatingFolder(false); return; }
    try {
      const res = await fetch('/api/media/folders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, accountKey: accountKey ?? null, parentId: currentFolderId }),
      });
      if (!res.ok) throw new Error();
      setNewFolderName('');
      setCreatingFolder(false);
      loadFolders();
    } catch {
      toast.error('Could not create folder');
    }
  }, [newFolderName, accountKey, currentFolderId, loadFolders]);

  const renameFolder = useCallback(async (id: string) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    try {
      const res = await fetch(`/api/media/folders/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      loadFolders();
    } catch {
      toast.error('Could not rename folder');
    }
  }, [renameValue, loadFolders]);

  const deleteFolder = useCallback(async (id: string) => {
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/media/folders/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      loadFolders();
      loadMedia();
    } catch {
      toast.error('Could not delete folder');
    }
  }, [loadFolders, loadMedia]);

  const moveAsset = useCallback(async (assetId: string, targetFolderId: string | null) => {
    if (targetFolderId === currentFolderId) return; // same place — no-op
    try {
      const res = await fetch(`/api/media/${assetId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ folderId: targetFolderId ?? 'root' }),
      });
      if (!res.ok) throw new Error();
      setFiles((prev) => prev.filter((f) => f.id !== assetId)); // it left this view
      toast.success('Moved');
    } catch {
      toast.error('Could not move');
    }
  }, [currentFolderId]);

  // ── Derived ──
  const subfolders = useMemo(
    () => (inBranding ? [] : folders.filter((f) => (f.parentId ?? null) === currentFolderId)),
    [folders, currentFolderId, inBranding],
  );

  const breadcrumb = useMemo(() => {
    if (inBranding) return [{ id: BRANDING_VIEW, name: 'Branding' }];
    const byId = new Map(folders.map((f) => [f.id, f]));
    const path: { id: string; name: string }[] = [];
    let cur: string | null = currentFolderId;
    while (cur) {
      const f = byId.get(cur);
      if (!f) break;
      path.unshift({ id: f.id, name: f.name });
      cur = f.parentId;
    }
    return path;
  }, [inBranding, folders, currentFolderId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, search]);

  // ── Escape + mount ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  if (!mounted) return null;

  const isImageFile = (f: MediaFile) => f.type?.startsWith('image') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f.url || '');

  return createPortal(
    <div
      className={`fixed inset-0 z-[220] bg-black/50 animate-overlay-in flex items-center justify-center ${fullScreen ? 'p-2 sm:p-4' : ''}`}
      onClick={onClose}
    >
      <div
        className={`glass-modal flex flex-col overflow-hidden ${
          fullScreen ? 'w-[92vw] h-[88vh] md:w-[72vw] md:h-[68vh] xl:w-[60vw] xl:h-[60vh] rounded-xl sm:rounded-2xl' : 'w-[880px] max-h-[90vh] rounded-2xl'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
          <PhotoIcon className="w-5 h-5 text-[var(--muted-foreground)]" />
          <h3 className="text-base font-semibold flex-shrink-0">Select Image</h3>
          <div className="relative flex-1 max-w-xs">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-1.5 outline-none focus:border-[var(--primary)]"
              placeholder="Search files..."
            />
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* ── Category filter ── */}
        {showCategories && !inBranding && (
          <div className="flex flex-wrap items-center gap-1.5 px-5 pt-3">
            <button
              onClick={() => setActiveCategory(undefined)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${!activeCategory ? 'bg-[var(--primary)] text-white' : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
            >
              All
            </button>
            {MEDIA_CATEGORIES.map((c) => (
              <button
                key={c.value}
                onClick={() => setActiveCategory(c.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${activeCategory === c.value ? 'bg-[var(--primary)] text-white' : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Breadcrumb + New folder ── */}
        {showFolders && (
          <div className="flex items-center gap-1 px-5 pt-3 text-sm">
            <button
              onClick={() => setCurrentFolderId(null)}
              onDragOver={(e) => { if (dragAssetId) e.preventDefault(); }}
              onDrop={() => dragAssetId && moveAsset(dragAssetId, null)}
              className={`rounded-md px-2 py-0.5 font-medium transition-colors ${currentFolderId === null ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'}`}
            >
              All media
            </button>
            {breadcrumb.map((c) => (
              <span key={c.id} className="flex items-center gap-1">
                <ChevronRightIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                <button
                  onClick={() => setCurrentFolderId(c.id)}
                  onDragOver={(e) => { if (dragAssetId && c.id !== BRANDING_VIEW) e.preventDefault(); }}
                  onDrop={() => dragAssetId && c.id !== BRANDING_VIEW && moveAsset(dragAssetId, c.id)}
                  className="rounded-md px-2 py-0.5 font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
                >
                  {c.name}
                </button>
              </span>
            ))}
            {!inBranding && (
              <button
                onClick={() => { setCreatingFolder(true); setNewFolderName(''); }}
                className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
              >
                <FolderPlusIcon className="w-4 h-4" /> New folder
              </button>
            )}
          </div>
        )}

        {/* ── Upload zone ── (hidden in the read-only Branding view) */}
        {!inBranding && (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            className={`mx-4 mt-3 border-2 border-dashed rounded-lg p-3 text-center transition-all cursor-pointer ${dragOver ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--border)] hover:border-[var(--muted-foreground)]'}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={(e) => handleUpload(e.target.files)} className="hidden" />
            <span className="text-sm text-[var(--muted-foreground)]">
              <ArrowUpTrayIcon className={`w-4 h-4 inline mr-1 ${uploading ? 'animate-bounce' : ''}`} />
              {uploading ? 'Uploading...' : showFolders && currentFolderId ? 'Drop files into this folder' : 'Drop files here or click to browse'}
            </span>
          </div>
        )}

        {/* ── Grid ── */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {/* New-folder inline tile */}
            {showFolders && creatingFolder && !inBranding && (
              <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/5 h-[120px] px-2">
                <FolderIcon className="w-6 h-6 text-[var(--primary)]" />
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); } }}
                  onBlur={createFolder}
                  placeholder="Folder name"
                  className="w-full text-xs text-center bg-[var(--background)] border border-[var(--border)] rounded px-1 py-1 outline-none focus:border-[var(--primary)]"
                />
              </div>
            )}

            {/* Subfolder tiles (drop targets for moving assets) */}
            {showFolders && subfolders.map((f) => (
              <div
                key={f.id}
                onClick={() => renamingId !== f.id && setCurrentFolderId(f.id)}
                onDragOver={(e) => { if (dragAssetId) e.preventDefault(); }}
                onDrop={() => dragAssetId && moveAsset(dragAssetId, f.id)}
                className="group relative flex flex-col items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 h-[120px] px-2 cursor-pointer hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 transition-colors"
                title={f.name}
              >
                <FolderIcon className="w-8 h-8 text-[var(--muted-foreground)] group-hover:text-[var(--primary)]" />
                {renamingId === f.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => { if (e.key === 'Enter') renameFolder(f.id); if (e.key === 'Escape') setRenamingId(null); }}
                    onBlur={() => renameFolder(f.id)}
                    className="w-full text-xs text-center bg-[var(--background)] border border-[var(--border)] rounded px-1 py-0.5 outline-none focus:border-[var(--primary)]"
                  />
                ) : (
                  <span className="text-[11px] font-medium text-[var(--foreground)] truncate max-w-full">{f.name}</span>
                )}
                {/* hover actions */}
                {renamingId !== f.id && (
                  <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenamingId(f.id); setRenameValue(f.name); }}
                      title="Rename" className="rounded p-1 bg-[var(--card-strong)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] shadow-sm"
                    >
                      <PencilIcon className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(f.id); }}
                      title="Delete" className="rounded p-1 bg-[var(--card-strong)] text-[var(--muted-foreground)] hover:text-red-500 shadow-sm"
                    >
                      <TrashIcon className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {confirmDeleteId === f.id && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-lg bg-[var(--card-strong)]/95 p-2 text-center" onClick={(e) => e.stopPropagation()}>
                    <span className="text-[10px] text-[var(--muted-foreground)]">Delete folder? Files move up a level.</span>
                    <div className="flex gap-1.5">
                      <button onClick={() => deleteFolder(f.id)} className="rounded bg-red-500 px-2 py-0.5 text-[10px] font-medium text-white">Delete</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="rounded bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Branding virtual folder (root only) */}
            {showFolders && currentFolderId === null && brandingMedia && brandingMedia.length > 0 && (
              <button
                onClick={() => setCurrentFolderId(BRANDING_VIEW)}
                className="group flex flex-col items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 h-[120px] px-2 hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 transition-colors"
                title="Branding (read-only)"
              >
                <SparklesIcon className="w-8 h-8 text-[var(--muted-foreground)] group-hover:text-[var(--primary)]" />
                <span className="text-[11px] font-medium text-[var(--foreground)]">Branding</span>
                <span className="text-[9px] text-[var(--muted-foreground)]">read-only</span>
              </button>
            )}

            {/* Branding assets (read-only) */}
            {inBranding && (brandingMedia ?? []).map((b) => (
              <button
                key={b.url}
                onClick={() => onSelect(b.url)}
                className="text-left rounded-lg overflow-hidden border border-transparent hover:border-[var(--primary)] hover:ring-1 hover:ring-[var(--primary)]/30 transition-all group"
                title={b.label}
              >
                <div className="h-[120px] bg-[var(--muted)] overflow-hidden flex items-center justify-center [background-image:linear-gradient(45deg,#e2e8f022_25%,transparent_25%,transparent_75%,#e2e8f022_75%),linear-gradient(45deg,#e2e8f022_25%,transparent_25%,transparent_75%,#e2e8f022_75%)] [background-size:16px_16px] [background-position:0_0,8px_8px]">
                  <img src={b.url} alt={b.label} className="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform duration-200" loading="lazy" />
                </div>
                <p className="text-[10px] truncate px-1.5 py-1 text-[var(--muted-foreground)]">{b.label}</p>
              </button>
            ))}

            {/* Asset tiles (draggable to move) */}
            {!inBranding && filtered.map((f) => (
              <button
                key={f.id}
                onClick={() => onSelect(f.url, f)}
                draggable={showFolders}
                onDragStart={() => setDragAssetId(f.id)}
                onDragEnd={() => setDragAssetId(null)}
                className="text-left rounded-lg overflow-hidden border border-transparent hover:border-[var(--primary)] hover:ring-1 hover:ring-[var(--primary)]/30 transition-all group"
                title={showFolders ? `${f.name} — drag onto a folder to move` : f.name}
              >
                <div className="h-[120px] bg-[var(--muted)] overflow-hidden">
                  {isImageFile(f) && f.url ? (
                    <img src={f.thumbnailUrl || f.url} alt={f.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy" />
                  ) : (
                    <div className="flex items-center justify-center h-full"><PhotoIcon className="w-6 h-6 text-[var(--muted-foreground)] opacity-30" /></div>
                  )}
                </div>
                <p className="text-[10px] truncate px-1.5 py-1 text-[var(--muted-foreground)]">{f.name}</p>
              </button>
            ))}
          </div>

          {/* Loading / empty states */}
          {loading && (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="animate-pulse"><div className="h-[120px] bg-[var(--muted)] rounded-lg" /></div>
              ))}
            </div>
          )}
          {!loading && filtered.length === 0 && subfolders.length === 0 && !creatingFolder && !inBranding && (
            <div className="text-center py-12 text-[var(--muted-foreground)]">
              <PhotoIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">This folder is empty</p>
              <p className="text-xs mt-1 opacity-60">Upload an image or create a folder</p>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)]">
          <p className="text-xs text-[var(--muted-foreground)]">
            {inBranding ? `${(brandingMedia ?? []).length} branding asset${(brandingMedia ?? []).length !== 1 ? 's' : ''}` : loading ? 'Loading...' : `${filtered.length} file${filtered.length !== 1 ? 's' : ''}`}
          </p>
          {nextCursor && !loading && !inBranding && (
            <button onClick={() => loadMedia(nextCursor)} disabled={loadingMore} className="text-xs font-medium text-[var(--primary)] hover:opacity-80 disabled:opacity-50">
              {loadingMore ? 'Loading...' : 'Load More'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
