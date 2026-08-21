'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  PhotoIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  ArrowUpTrayIcon,
  ChevronRightIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { MEDIA_CATEGORIES } from '@/lib/media-categories';
import type { RightsStatus } from '@/lib/media-rights';
import {
  countOutOfLicence,
  defaultApprovedOnly,
  isOutOfLicence as assetOutOfLicence,
  orderPickerAssets,
} from '@/lib/media-picker-order';

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

  // ── Lifecycle (already served by serializeMediaAsset) ──
  /** 'draft' | 'approved' — whether this is cleared for use. */
  status?: string | null;
  /** Derived rights position; `unknown` when no licence is recorded. */
  rights?: { status: RightsStatus; daysRemaining: number | null } | null;
}

/** A read-only branding asset surfaced in the picker (managed in Branding
 *  settings — the single source of truth — so it isn't editable here). */
export interface BrandingMediaItem {
  label: string;
  url: string;
}

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
  /** Read-only branding assets (e.g. the account's logo variants), offered as a
   *  sub-view of the picker. Selectable but not editable here. */
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
  /**
   * Whether the branding sub-view is open.
   *
   * Was a pseudo-folder id ('__branding__') back when the picker had folders.
   * It never was a folder — it's a different SOURCE of assets — and a boolean
   * says so without pretending otherwise.
   */
  const [inBranding, setInBranding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  }, [accountKey, showCategories, activeCategory, inBranding]);

  useEffect(() => { loadMedia(); }, [loadMedia]);

  // ── Upload ──
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
  }, [accountKey, uploadCategory, activeCategory, inBranding]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  }, [handleUpload]);

  /**
   * Whether to show only assets cleared for use.
   *
   * Defaults OFF, deliberately. Approval shipped with everything already in the
   * library sitting at `draft`, so defaulting this on would empty the picker and
   * break the ad builder on day one. Once a first batch is approved this becomes
   * the sensible default — a one-line change here.
   *
   * Remembered per session so someone reviewing compliant creative doesn't
   * re-tick it for every asset they place.
   */
  /**
   * null = no explicit choice yet, so the default is derived from what's
   * actually in the library (see defaultApprovedOnly). A stored 'true'/'false'
   * is a decision someone made and always wins.
   */
  const [approvedChoice, setApprovedChoice] = useState<boolean | null>(() => {
    if (typeof window === 'undefined') return null;
    const stored = sessionStorage.getItem('media-picker-approved-only');
    return stored === null ? null : stored === 'true';
  });
  const toggleApprovedOnly = useCallback((next: boolean) => {
    setApprovedChoice(next);
    if (typeof window !== 'undefined') {
      // Both values are stored, including false: "I deliberately want drafts"
      // has to survive, and removing the key would fall back to the adaptive
      // default and silently re-tick the box on the next open.
      sessionStorage.setItem('media-picker-approved-only', String(next));
    }
  }, []);

  /** The effective setting: an explicit choice, else derived from the library. */
  const approvedOnly = approvedChoice ?? defaultApprovedOnly(files);

  /** Ordering and filtering live in lib/media-picker-order.ts, where they're tested. */
  const filtered = useMemo(
    () => orderPickerAssets(files, { approvedOnly, search }),
    [files, search, approvedOnly],
  );

  /** How many of the loaded assets are unusable as-is — drives the warning strip. */
  const outOfLicenceCount = useMemo(() => countOutOfLicence(filtered), [filtered]);

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
          {/* Approved-only. A checkbox rather than a tab because it composes with
              the category filter and the folder you're in, instead of replacing
              them. */}
          {!inBranding && (
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]">
              <input
                type="checkbox"
                checked={approvedOnly}
                onChange={(e) => toggleApprovedOnly(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--primary)]"
              />
              Approved only
            </label>
          )}
          <button onClick={onClose} className="p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Out-of-licence warning. Stated once at the top rather than only per
            tile: the risk is placing one without noticing, and a badge on a
            120px thumbnail is easy to miss. */}
        {!inBranding && outOfLicenceCount > 0 && !approvedOnly && (
          <div className="mx-5 mt-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
            <p className="text-[11px] leading-snug text-red-400">
              {outOfLicenceCount} asset{outOfLicenceCount === 1 ? ' is' : 's are'} past
              their licence or campaign date and shouldn&apos;t go into live creative.
              They&apos;re greyed out and sorted last.
            </p>
          </div>
        )}

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

        {/* Back out of the branding sub-view. Nothing else nests, so this is the
            only navigation the picker needs. */}
        {inBranding && (
          <div className="flex items-center gap-1 px-5 pt-3 text-sm">
            <button
              onClick={() => setInBranding(false)}
              className="rounded-md px-2 py-0.5 font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            >
              All media
            </button>
            <ChevronRightIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
            <span className="px-2 py-0.5 font-medium text-[var(--foreground)]">Branding</span>
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
              {uploading ? 'Uploading...' : 'Drop files here or click to browse'}
            </span>
          </div>
        )}

        {/* ── Grid ── */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {/* Entry into the branding sub-view. */}
            {!inBranding && brandingMedia && brandingMedia.length > 0 && (
              <button
                onClick={() => setInBranding(true)}
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

            {!inBranding && filtered.map((f) => {
              const outOfLicence = assetOutOfLicence(f);
              const expiringSoon = f.rights?.status === 'expiring_soon';
              return (
              <button
                key={f.id}
                onClick={() => onSelect(f.url, f)}
                className="text-left rounded-lg overflow-hidden border border-transparent hover:border-[var(--primary)] hover:ring-1 hover:ring-[var(--primary)]/30 transition-all group"
                title={[
                  f.name,
                  f.status === 'approved' ? 'Approved' : 'Not yet approved',
                  outOfLicence ? 'OUT OF LICENCE — do not use in live creative' : null,
                  expiringSoon && f.rights?.daysRemaining != null
                    ? `Licence expires in ${f.rights.daysRemaining} days`
                    : null,
                ].filter(Boolean).join(' · ')}
              >
                <div className="relative h-[120px] bg-[var(--muted)] overflow-hidden">
                  {/* Thumbnail only, never the original — a 120px picker tile
                      must not pull a multi-megabyte asset. See media/page.tsx. */}
                  {isImageFile(f) && f.thumbnailUrl ? (
                    <img
                      src={f.thumbnailUrl}
                      alt={f.name}
                      // Desaturated rather than hidden: still selectable, but it
                      // can't be mistaken for cleared creative at a glance.
                      className={`w-full h-full object-cover transition-transform duration-200 group-hover:scale-105 ${outOfLicence ? 'opacity-40 grayscale' : ''}`}
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full"><PhotoIcon className="w-6 h-6 text-[var(--muted-foreground)] opacity-30" /></div>
                  )}
                  {outOfLicence && (
                    <span className="absolute left-1 top-1 rounded bg-red-500/90 px-1 py-0.5 text-[9px] font-medium text-white">
                      Expired
                    </span>
                  )}
                  {!outOfLicence && expiringSoon && (
                    <span className="absolute left-1 top-1 rounded bg-amber-500/90 px-1 py-0.5 text-[9px] font-medium text-white">
                      {f.rights?.daysRemaining}d
                    </span>
                  )}
                  {/* Only 'approved' is badged. Marking every draft would badge
                      the entire library, which is noise rather than signal. */}
                  {f.status === 'approved' && (
                    <span className="absolute right-1 top-1 rounded bg-emerald-500/90 px-1 py-0.5 text-[9px] font-medium text-white">
                      ✓
                    </span>
                  )}
                </div>
                <p className="text-[10px] truncate px-1.5 py-1 text-[var(--muted-foreground)]">{f.name}</p>
              </button>
              );
            })}
          </div>

          {/* Loading / empty states */}
          {loading && (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="animate-pulse"><div className="h-[120px] bg-[var(--muted)] rounded-lg" /></div>
              ))}
            </div>
          )}
          {!loading && filtered.length === 0 && !inBranding && (
            <div className="text-center py-12 text-[var(--muted-foreground)]">
              <PhotoIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">
                {approvedOnly ? 'No approved media here' : 'No media here yet'}
              </p>
              <p className="text-xs mt-1 opacity-60">
                {approvedOnly ? 'Untick “Approved only” to see drafts.' : 'Upload an image to get started.'}
              </p>
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
