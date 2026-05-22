'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  PhotoIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  EllipsisVerticalIcon,
  TrashIcon,
  PencilSquareIcon,
  ArrowUpTrayIcon,
  Square2StackIcon,
  ExclamationTriangleIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  HomeIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  EyeIcon,
  CheckIcon,
  FolderArrowDownIcon,
  Squares2X2Icon,
  ListBulletIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { safeJson } from '@/lib/safe-json';
import { useAccount, type AccountData } from '@/contexts/account-context';
import { useLoomiDialog } from '@/contexts/loomi-dialog-context';
import { AccountAvatar } from '@/components/account-avatar';
import BulkActionDock from '@/components/bulk-action-dock';
import PrimaryButton from '@/components/primary-button';

// ── Constants ──

const MAX_MEDIA_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// ── Types ──

interface MediaFile {
  id: string;
  name: string;
  url: string;
  type: string;
  size?: number;
  thumbnailUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  source?: 'esp' | 's3';
  category?: string;
}

interface MediaFolder {
  id: string;
  name: string;
  parentId?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface FolderBreadcrumb {
  id: string | undefined; // undefined = root
  name: string;
}

interface MediaCapabilities {
  canUpload: boolean;
  canDelete: boolean;
  canRename: boolean;
  canMove: boolean;
  canCreateFolders: boolean;
  canNavigateFolders: boolean;
}

interface AccountMediaPreview {
  files: MediaFile[];
  totalCount?: number;
  provider: string | null;
  capabilities: MediaCapabilities | null;
  loading: boolean;
  error?: string;
}

interface ProviderInfo {
  id: string;
  displayName: string;
  iconSrc?: string;
}

// ── Helpers ──

// All media now flows through Loomi-native S3 storage. The provider
// catalog used to map remote-ESP IDs (ghl/klaviyo) to display labels
// but with the ESP teardown those branches are gone; only the 's3'
// entry remains for the source pill on each media row.
const PROVIDER_META: Record<string, ProviderInfo> = {
  s3: {
    id: 's3',
    displayName: 'Loomi',
    iconSrc: undefined,
  },
};

const S3_CAPABILITIES: MediaCapabilities = {
  canUpload: true,
  canDelete: true,
  canRename: true,
  canMove: false,
  canCreateFolders: false,
  canNavigateFolders: false,
};

function CropIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M 11.970703 3.9726562 A 2.0002 2.0002 0 0 0 10 6 L 10 10 L 6 10 A 2.0002 2.0002 0 1 0 6 14 L 10 14 L 10 31 C 10 34.842251 13.157749 38 17 38 L 34 38 L 34 42 A 2.0002 2.0002 0 1 0 38 42 L 38 38 L 42 38 A 2.0002 2.0002 0 1 0 42 34 L 17 34 C 15.320251 34 14 32.679749 14 31 L 14 6 A 2.0002 2.0002 0 0 0 11.970703 3.9726562 z M 16 10 L 16 14 L 31 14 C 32.679749 14 34 15.320251 34 17 L 34 32 L 38 32 L 38 17 C 38 13.157749 34.842251 10 31 10 L 16 10 z" />
    </svg>
  );
}

function providerLabel(provider: string): string {
  return PROVIDER_META[provider]?.displayName || provider;
}

function providerIcon(provider: string): string | undefined {
  return PROVIDER_META[provider]?.iconSrc;
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatFileSize(bytes: number | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mediaItemKey(file: MediaFile): string {
  const source = file.source || 'esp';
  const id = (file.id || '').trim();
  const url = (file.url || '').trim();
  const name = (file.name || '').trim();
  const createdAt = (file.createdAt || '').trim();

  if (id) return `${source}:id:${id}`;
  if (url) return `${source}:url:${url}`;
  return `${source}:name:${name}:created:${createdAt}`;
}

function stagedFileKey(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}::${file.type}`;
}

function hasFilePayload(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer?.types) return false;
  return Array.from(dataTransfer.types).includes('Files');
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type CropResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type CropInteraction =
  | {
    mode: 'draw' | 'move';
    startPoint: { x: number; y: number };
    originCrop: CropRect;
  }
  | {
    mode: 'resize';
    startPoint: { x: number; y: number };
    originCrop: CropRect;
    handle: CropResizeHandle;
  };

const MIN_CROP_SIZE = 0.02;

const FREE_CROP_HANDLES: Array<{
  id: CropResizeHandle;
  className: string;
  cursorClassName: string;
}> = [
  { id: 'n', className: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-6 h-3', cursorClassName: 'cursor-ns-resize' },
  { id: 's', className: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 w-6 h-3', cursorClassName: 'cursor-ns-resize' },
  { id: 'e', className: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-3 h-6', cursorClassName: 'cursor-ew-resize' },
  { id: 'w', className: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-6', cursorClassName: 'cursor-ew-resize' },
  { id: 'ne', className: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5', cursorClassName: 'cursor-nesw-resize' },
  { id: 'nw', className: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5', cursorClassName: 'cursor-nwse-resize' },
  { id: 'se', className: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 w-3.5 h-3.5', cursorClassName: 'cursor-nwse-resize' },
  { id: 'sw', className: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 w-3.5 h-3.5', cursorClassName: 'cursor-nesw-resize' },
];

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function defaultCropRect(aspectRatio: number | null): CropRect {
  if (!aspectRatio) {
    return { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  }

  const maxWidth = 0.82;
  const maxHeight = 0.82;
  let width = maxWidth;
  let height = width / aspectRatio;

  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspectRatio;
  }

  return {
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height,
  };
}

function computeDragCrop(
  start: { x: number; y: number },
  end: { x: number; y: number },
  aspectRatio: number | null,
): CropRect {
  if (!aspectRatio) {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    return {
      x: clampNumber(x, 0, 1),
      y: clampNumber(y, 0, 1),
      width: clampNumber(width, 0, 1),
      height: clampNumber(height, 0, 1),
    };
  }

  const dragRight = end.x >= start.x;
  const dragDown = end.y >= start.y;

  let width = Math.abs(end.x - start.x);
  let maxWidth = dragRight ? 1 - start.x : start.x;
  maxWidth = clampNumber(maxWidth, 0, 1);

  width = Math.min(width, maxWidth);
  let height = width / aspectRatio;

  const maxHeight = dragDown ? 1 - start.y : start.y;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspectRatio;
  }

  const x = dragRight ? start.x : start.x - width;
  const y = dragDown ? start.y : start.y - height;

  return {
    x: clampNumber(x, 0, 1),
    y: clampNumber(y, 0, 1),
    width: clampNumber(width, 0, 1),
    height: clampNumber(height, 0, 1),
  };
}

function moveCropRect(
  crop: CropRect,
  deltaX: number,
  deltaY: number,
): CropRect {
  return {
    x: clampNumber(crop.x + deltaX, 0, Math.max(0, 1 - crop.width)),
    y: clampNumber(crop.y + deltaY, 0, Math.max(0, 1 - crop.height)),
    width: crop.width,
    height: crop.height,
  };
}

function resizeFreeCropRect(
  crop: CropRect,
  handle: CropResizeHandle,
  point: { x: number; y: number },
): CropRect {
  let left = crop.x;
  let right = crop.x + crop.width;
  let top = crop.y;
  let bottom = crop.y + crop.height;

  if (handle.includes('w')) {
    left = clampNumber(point.x, 0, right - MIN_CROP_SIZE);
  }
  if (handle.includes('e')) {
    right = clampNumber(point.x, left + MIN_CROP_SIZE, 1);
  }
  if (handle.includes('n')) {
    top = clampNumber(point.y, 0, bottom - MIN_CROP_SIZE);
  }
  if (handle.includes('s')) {
    bottom = clampNumber(point.y, top + MIN_CROP_SIZE, 1);
  }

  return {
    x: left,
    y: top,
    width: clampNumber(right - left, MIN_CROP_SIZE, 1),
    height: clampNumber(bottom - top, MIN_CROP_SIZE, 1),
  };
}

function cropOutputMimeType(inputType: string | undefined): string {
  if (inputType === 'image/jpeg' || inputType === 'image/png' || inputType === 'image/webp') {
    return inputType;
  }
  return 'image/png';
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function makeCroppedFileName(originalName: string, mimeType: string): string {
  const trimmed = (originalName || '').trim();
  const dotIndex = trimmed.lastIndexOf('.');
  const baseName = dotIndex > 0 ? trimmed.slice(0, dotIndex) : (trimmed || 'image');
  const ext = extensionFromMimeType(mimeType);
  return `${baseName}-cropped.${ext}`;
}

interface CropEditorModalProps {
  file: MediaFile;
  saving: boolean;
  onClose: () => void;
  onSave: (crop: CropRect) => void;
}

function CropEditorModal({ file, saving, onClose, onSave }: CropEditorModalProps) {
  const imageWrapRef = useRef<HTMLDivElement>(null);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [crop, setCrop] = useState<CropRect>(() => defaultCropRect(null));
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const interactionRef = useRef<CropInteraction | null>(null);
  const dragMovedRef = useRef(false);
  const cropBeforeDragRef = useRef<CropRect>(crop);

  const hasSelection = crop.width >= 0.01 && crop.height >= 0.01;
  const canSave = !saving && hasSelection && naturalSize.width > 0 && naturalSize.height > 0;

  const getPoint = useCallback((clientX: number, clientY: number) => {
    const wrapper = imageWrapRef.current;
    if (!wrapper) return null;
    const bounds = wrapper.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      x: clampNumber((clientX - bounds.left) / bounds.width, 0, 1),
      y: clampNumber((clientY - bounds.top) / bounds.height, 0, 1),
    };
  }, []);

  const beginInteraction = (interaction: CropInteraction) => {
    interactionRef.current = interaction;
    dragMovedRef.current = false;
    cropBeforeDragRef.current = crop;
  };

  const handleImageMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (saving) return;
    const point = getPoint(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    beginInteraction({
      mode: 'draw',
      startPoint: point,
      originCrop: crop,
    });
  };

  const handleSelectionMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (saving || !hasSelection) return;
    const point = getPoint(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    beginInteraction({
      mode: 'move',
      startPoint: point,
      originCrop: crop,
    });
  };

  const handleResizeHandleMouseDown = (handle: CropResizeHandle) => (event: React.MouseEvent<HTMLButtonElement>) => {
    if (saving) return;
    const point = getPoint(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    beginInteraction({
      mode: 'resize',
      startPoint: point,
      originCrop: crop,
      handle,
    });
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      const point = getPoint(event.clientX, event.clientY);
      if (!point) return;

      dragMovedRef.current = true;
      if (interaction.mode === 'draw') {
        setCrop(computeDragCrop(interaction.startPoint, point, aspectRatio));
        return;
      }
      if (interaction.mode === 'move') {
        setCrop(moveCropRect(
          interaction.originCrop,
          point.x - interaction.startPoint.x,
          point.y - interaction.startPoint.y,
        ));
        return;
      }
      if (interaction.mode === 'resize' && aspectRatio === null) {
        setCrop(resizeFreeCropRect(interaction.originCrop, interaction.handle, point));
      }
    };

    const handleMouseUp = () => {
      if (!interactionRef.current) return;
      if (!dragMovedRef.current) {
        setCrop(cropBeforeDragRef.current);
      }
      interactionRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [aspectRatio, getPoint]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  const setAspectPreset = (value: number | null) => {
    setAspectRatio(value);
    setCrop(defaultCropRect(value));
  };

  const handleSave = () => {
    if (!canSave) return;

    const safeX = Math.min(Math.max(Math.round(crop.x * naturalSize.width), 0), Math.max(0, naturalSize.width - 1));
    const safeY = Math.min(Math.max(Math.round(crop.y * naturalSize.height), 0), Math.max(0, naturalSize.height - 1));
    const maxWidth = Math.max(1, naturalSize.width - safeX);
    const maxHeight = Math.max(1, naturalSize.height - safeY);
    const safeWidth = Math.max(1, Math.min(Math.round(crop.width * naturalSize.width), maxWidth));
    const safeHeight = Math.max(1, Math.min(Math.round(crop.height * naturalSize.height), maxHeight));

    onSave({
      x: safeX,
      y: safeY,
      width: safeWidth,
      height: safeHeight,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 animate-overlay-in"
      onClick={() => { if (!saving) onClose(); }}
    >
      <div className="glass-modal w-full max-w-5xl max-h-[92vh] flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Crop Image</h3>
            <p className="text-[11px] text-[var(--muted-foreground)] truncate mt-0.5" title={file.name}>
              {file.name}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="rounded-xl bg-black/20 min-h-[320px]">
            <div className="w-full h-full flex items-center justify-center p-4">
              <div
                ref={imageWrapRef}
                onMouseDown={handleImageMouseDown}
                className="relative inline-block cursor-crosshair select-none touch-none"
              >
                <img
                  src={file.url}
                  alt={file.name}
                  className="block max-w-full max-h-[60vh] object-contain pointer-events-none"
                  onLoad={(event) => {
                    setNaturalSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    });
                  }}
                />

                {hasSelection && (
                  <div
                    onMouseDown={handleSelectionMouseDown}
                    className="absolute border-2 border-white rounded-[2px] cursor-move"
                    style={{
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.width * 100}%`,
                      height: `${crop.height * 100}%`,
                      boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
                    }}
                  >
                    {aspectRatio === null && FREE_CROP_HANDLES.map((handle) => (
                      <button
                        key={handle.id}
                        type="button"
                        onMouseDown={handleResizeHandleMouseDown(handle.id)}
                        aria-label={`Resize crop ${handle.id}`}
                        className={`absolute rounded-full border border-white bg-[var(--primary)] shadow-[0_0_0_1px_rgba(0,0,0,0.35)] ${handle.className} ${handle.cursorClassName}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[var(--muted-foreground)]">
              {aspectRatio === null
                ? 'Drag on the image to set the crop area, then drag the box or its edges to fine-tune.'
                : 'Drag on the image to set the crop area, then drag the box to reposition it.'}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { label: 'Free', value: null as number | null },
                { label: '1:1', value: 1 },
                { label: '4:3', value: 4 / 3 },
                { label: '16:9', value: 16 / 9 },
              ].map((option) => {
                const selected = option.value === aspectRatio;
                return (
                  <button
                    key={option.label}
                    onClick={() => setAspectPreset(option.value)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                      selected
                        ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                        : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
              <button
                onClick={() => setCrop(defaultCropRect(aspectRatio))}
                className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[var(--primary)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <CropIcon className="w-4 h-4" />
            {saving ? 'Cropping...' : 'Crop & Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Extracted sub-components (stable references — never defined inside a render) ──

function ProviderPill({ prov }: { prov: string }) {
  const icon = providerIcon(prov);
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--muted)] text-[10px] font-medium text-[var(--muted-foreground)]">
      {icon && (
        <img src={icon} alt={providerLabel(prov)} className="w-3.5 h-3.5 rounded-full object-cover" />
      )}
      {providerLabel(prov)}
    </span>
  );
}

interface MediaCardProps {
  f: MediaFile;
  isMenuOpen: boolean;
  isSelected: boolean;
  selectMode: boolean;
  provider: string | null;
  capabilities: MediaCapabilities | null;
  menuClickRef: React.MutableRefObject<boolean>;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  onSelect: () => void;
  onPreview: () => void;
  onCopyUrl: () => void;
  onDownload?: () => void;
  onMove?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}

function MediaCard({
  f,
  isMenuOpen,
  isSelected,
  selectMode,
  provider: activeProvider,
  capabilities: activeCaps,
  menuClickRef,
  draggable,
  onDragStart,
  onMenuToggle,
  onMenuClose,
  onSelect,
  onPreview,
  onCopyUrl,
  onDownload,
  onMove,
  onRename,
  onDelete,
}: MediaCardProps) {
  const isImage = f.type?.startsWith('image') || f.url?.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
  const caps = f.source === 's3' ? S3_CAPABILITIES : activeCaps;

  return (
    <div
      className={`glass-card rounded-xl group animate-fade-in-up relative ${isMenuOpen ? 'z-30' : 'z-0'} ${isSelected ? 'ring-2 ring-[var(--primary)]' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      {/* Thumbnail */}
      <div
        className="h-[140px] bg-[var(--muted)] relative overflow-hidden rounded-t-xl cursor-pointer"
        onClick={() => selectMode ? onSelect() : onPreview()}
      >
        {isImage && f.url ? (
          <img
            src={f.thumbnailUrl || f.url}
            alt={f.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <PhotoIcon className="w-10 h-10 text-[var(--muted-foreground)] opacity-30" />
          </div>
        )}
        {/* Select checkbox */}
        {selectMode && (
          <div className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            isSelected
              ? 'bg-[var(--primary)] border-[var(--primary)]'
              : 'bg-black/40 border-white/60 hover:border-white'
          }`}>
            {isSelected && <CheckIcon className="w-3.5 h-3.5 text-white" />}
          </div>
        )}
        {/* Hover overlay */}
        {!selectMode && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <EyeIcon className="w-6 h-6 text-white opacity-0 group-hover:opacity-80 transition-opacity drop-shadow-lg" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          {(f.source === 's3' ? <ProviderPill prov="s3" /> : activeProvider ? <ProviderPill prov={activeProvider} /> : null)}
          {!selectMode && (
            <div className="relative flex-shrink-0">
              <button
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  menuClickRef.current = true;
                  onMenuToggle();
                }}
                className={`p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors ${isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
              >
                <EllipsisVerticalIcon className="w-4 h-4" />
              </button>
              {isMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 w-44 glass-dropdown" onMouseDown={(e) => { e.stopPropagation(); menuClickRef.current = true; }}>
                  <button
                    onClick={() => { onMenuClose(); onCopyUrl(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                  >
                    <Square2StackIcon className="w-4 h-4" /> Copy URL
                  </button>
                  {onDownload && (
                    <button
                      onClick={() => { onMenuClose(); onDownload(); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                    >
                      <ArrowDownTrayIcon className="w-4 h-4" /> Download
                    </button>
                  )}
                  {caps?.canMove && onMove && (
                    <button
                      onClick={() => { onMenuClose(); onMove(); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                    >
                      <FolderArrowDownIcon className="w-4 h-4" /> Move
                    </button>
                  )}
                  {caps?.canRename && onRename && (
                    <button
                      onClick={() => { onMenuClose(); onRename(); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                    >
                      <PencilSquareIcon className="w-4 h-4" /> Rename
                    </button>
                  )}
                  {caps?.canDelete && onDelete && (
                    <button
                      onClick={() => { onMenuClose(); onDelete(); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <TrashIcon className="w-4 h-4" /> Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <h3 className="text-xs font-semibold truncate" title={f.name}>
          {f.name}
        </h3>
        <div className="flex items-center gap-2 mt-1">
          {f.size != null && (
            <span className="text-[10px] text-[var(--muted-foreground)]">
              {formatFileSize(f.size)}
            </span>
          )}
          <span className="text-[10px] text-[var(--muted-foreground)] ml-auto">
            {timeAgo(f.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

function MediaListRow({
  f,
  isMenuOpen,
  isSelected,
  selectMode,
  provider: activeProvider,
  capabilities: activeCaps,
  menuClickRef,
  draggable,
  onDragStart,
  onMenuToggle,
  onMenuClose,
  onSelect,
  onPreview,
  onCopyUrl,
  onDownload,
  onMove,
  onRename,
  onDelete,
}: MediaCardProps) {
  const isImage = f.type?.startsWith('image') || f.url?.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
  const caps = f.source === 's3' ? S3_CAPABILITIES : activeCaps;

  return (
    <div
      className={`glass-card rounded-lg group animate-fade-in-up relative ${isMenuOpen ? 'z-30' : 'z-0'} flex items-center gap-3 px-3 py-2.5 ${isSelected ? 'ring-2 ring-[var(--primary)]' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      {/* Select checkbox */}
      {selectMode && (
        <button onClick={onSelect} className="flex-shrink-0">
          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            isSelected
              ? 'bg-[var(--primary)] border-[var(--primary)]'
              : 'bg-[var(--muted)] border-[var(--border)] hover:border-[var(--primary)]'
          }`}>
            {isSelected && <CheckIcon className="w-3.5 h-3.5 text-white" />}
          </div>
        </button>
      )}
      {/* Thumbnail */}
      <div
        className="w-10 h-10 rounded-lg bg-[var(--muted)] overflow-hidden flex-shrink-0 cursor-pointer"
        onClick={() => selectMode ? onSelect() : onPreview()}
      >
        {isImage && f.url ? (
          <img src={f.thumbnailUrl || f.url} alt={f.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="flex items-center justify-center h-full">
            <PhotoIcon className="w-5 h-5 text-[var(--muted-foreground)] opacity-30" />
          </div>
        )}
      </div>
      {/* Name + meta */}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => selectMode ? onSelect() : onPreview()}>
        <p className="text-sm font-medium truncate">{f.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {f.size != null && (
            <span className="text-[10px] text-[var(--muted-foreground)]">{formatFileSize(f.size)}</span>
          )}
          <span className="text-[10px] text-[var(--muted-foreground)]">{timeAgo(f.createdAt)}</span>
        </div>
      </div>
      {/* Provider */}
      <div className="flex-shrink-0 hidden sm:block">
        {f.source === 's3' ? <ProviderPill prov="s3" /> : activeProvider ? <ProviderPill prov={activeProvider} /> : null}
      </div>
      {/* Actions */}
      {!selectMode && (
        <div className="relative flex-shrink-0">
          <button
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              menuClickRef.current = true;
              onMenuToggle();
            }}
            className={`p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors ${isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          >
            <EllipsisVerticalIcon className="w-4 h-4" />
          </button>
          {isMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-44 glass-dropdown" onMouseDown={(e) => { e.stopPropagation(); menuClickRef.current = true; }}>
              <button
                onClick={() => { onMenuClose(); onCopyUrl(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <Square2StackIcon className="w-4 h-4" /> Copy URL
              </button>
              {onDownload && (
                <button
                  onClick={() => { onMenuClose(); onDownload(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" /> Download
                </button>
              )}
              {caps?.canMove && onMove && (
                <button
                  onClick={() => { onMenuClose(); onMove(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <FolderArrowDownIcon className="w-4 h-4" /> Move
                </button>
              )}
              {caps?.canRename && onRename && (
                <button
                  onClick={() => { onMenuClose(); onRename(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  <PencilSquareIcon className="w-4 h-4" /> Rename
                </button>
              )}
              {caps?.canDelete && onDelete && (
                <button
                  onClick={() => { onMenuClose(); onDelete(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <TrashIcon className="w-4 h-4" /> Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface AccountCardProps {
  acctKey: string;
  acctData: AccountData | undefined;
  overviewRow: AccountMediaPreview | undefined;
  onSelect: () => void;
}

function AccountCard({ acctKey, acctData, overviewRow, onSelect }: AccountCardProps) {
  const acctName = acctData?.dealer || acctKey;
  const location = [acctData?.city, acctData?.state].filter(Boolean).join(', ');

  return (
    <button
      onClick={onSelect}
      className="glass-card rounded-xl p-5 text-left group hover:ring-1 hover:ring-[var(--primary)]/30 transition-all animate-fade-in-up"
    >
      <div className="flex items-start gap-3">
        <AccountAvatar
          name={acctName}
          accountKey={acctKey}
          storefrontImage={acctData?.storefrontImage}
          logos={acctData?.logos}
          size={40}
          className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-[var(--border)]"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold truncate group-hover:text-[var(--primary)] transition-colors">
            {acctName}
          </h3>
          {location && (
            <p className="text-[11px] text-[var(--muted-foreground)] truncate mt-0.5">{location}</p>
          )}
        </div>
        <ChevronRightIcon className="w-4 h-4 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity mt-1 flex-shrink-0" />
      </div>
      {/* File count summary */}
      {overviewRow && !overviewRow.loading && !overviewRow.error && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
            <PhotoIcon className="w-3.5 h-3.5" />
            <span>
              {(overviewRow.totalCount ?? 0) === 0
                ? 'No files'
                : `${overviewRow.totalCount} file${overviewRow.totalCount !== 1 ? 's' : ''}`}
            </span>
          </div>
        </div>
      )}
      {overviewRow?.loading && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <div className="h-3 bg-[var(--muted)] rounded w-16 animate-pulse" />
        </div>
      )}
      {overviewRow && !overviewRow.loading && overviewRow.error && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <div className="flex items-center gap-1.5 text-[10px] text-red-400">
            <ExclamationTriangleIcon className="w-3.5 h-3.5" />
            <span>Unable to load</span>
          </div>
        </div>
      )}
    </button>
  );
}

// ── Page ──

export default function MediaPage() {
  const { confirm } = useLoomiDialog();
  const { isAdmin, isAccount, accountKey, accountData, accounts } = useAccount();

  // ── Single-account detail state ──
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<MediaCapabilities | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');

  // Folder navigation
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const [folderPath, setFolderPath] = useState<FolderBreadcrumb[]>([{ id: undefined, name: 'Root' }]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);

  // Upload
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pageDragOver, setPageDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageDragDepthRef = useRef(0);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);

  // Modals
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [renameFile, setRenameFile] = useState<MediaFile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleteFile, setDeleteFile] = useState<MediaFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null);
  const [cropFile, setCropFile] = useState<MediaFile | null>(null);
  const [cropping, setCropping] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  // Move modal
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveItems, setMoveItems] = useState<{ id: string; type: 'file' | 'folder'; name?: string }[]>([]);
  const [moveFolders, setMoveFolders] = useState<MediaFolder[]>([]);
  const [moveFolderPath, setMoveFolderPath] = useState<FolderBreadcrumb[]>([{ id: undefined, name: 'Root' }]);
  const [moveLoading, setMoveLoading] = useState(false);
  const [moving, setMoving] = useState(false);

  // Folder context menu + delete
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [renameFolderItem, setRenameFolderItem] = useState<MediaFolder | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');
  const [renamingFolder, setRenamingFolder] = useState(false);
  const [deleteFolderItem, setDeleteFolderItem] = useState<MediaFolder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);

  // Drag-and-drop
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // View mode — persisted in localStorage
  const [viewMode, setViewModeRaw] = useState<'grid' | 'list'>(() => {
    if (typeof window === 'undefined') return 'grid';
    return (localStorage.getItem('media-view-mode') as 'grid' | 'list') ?? 'grid';
  });
  const setViewMode = useCallback((mode: 'grid' | 'list') => {
    setViewModeRaw(mode);
    if (typeof window !== 'undefined') localStorage.setItem('media-view-mode', mode);
  }, []);

  // Admin account filter — persisted in sessionStorage so it survives
  // unexpected component remounts (e.g. during session refreshes).
  const [accountFilter, setAccountFilterRaw] = useState<string>(() => {
    if (typeof window === 'undefined') return 'all';
    return sessionStorage.getItem('media-account-filter') ?? 'all';
  });
  const setAccountFilter = useCallback((value: string) => {
    setAccountFilterRaw(value);
    if (typeof window !== 'undefined') {
      if (value === 'all') sessionStorage.removeItem('media-account-filter');
      else sessionStorage.setItem('media-account-filter', value);
    }
  }, []);

  // ── Admin overview state ──
  const [overviewData, setOverviewData] = useState<Record<string, AccountMediaPreview>>({});
  const [overviewLoaded, setOverviewLoaded] = useState(false);
  const [overviewSearch, setOverviewSearch] = useState('');
  const [overviewTab, setOverviewTab] = useState<'subaccounts' | 'loomi'>('subaccounts');
  // ── Admin S3 media state ──
  const [adminMediaFiles, setAdminMediaFiles] = useState<MediaFile[]>([]);
  const [adminMediaTotal, setAdminMediaTotal] = useState(0);
  const [adminMediaLoading, setAdminMediaLoading] = useState(false);

  // Derive the effective account key
  const effectiveAccountKey = isAccount
    ? accountKey
    : accountFilter !== 'all'
      ? accountFilter
      : null;

  // Show overview when admin has no specific account selected
  const showOverview = isAdmin && !effectiveAccountKey;
  const canDropUploadFiles = showOverview || !!effectiveAccountKey;
  const isLoomiOverviewTab = showOverview && overviewTab === 'loomi';
  const isSubAccountOverviewTab = showOverview && overviewTab === 'subaccounts';

  // All account keys (sorted)
  const allAccountKeys = useMemo(() => {
    return Object.keys(accounts).sort((a, b) => {
      const nameA = accounts[a]?.dealer || a;
      const nameB = accounts[b]?.dealer || b;
      return nameA.localeCompare(nameB);
    });
  }, [accounts]);

  // Every account is "connected" now that media is Loomi-S3-backed.
  const connectedAccountKeys = allAccountKeys;

  // Filter overview accounts by search
  const filteredOverviewKeys = useMemo(() => {
    if (!overviewSearch.trim()) return connectedAccountKeys;
    const q = overviewSearch.toLowerCase();
    return connectedAccountKeys.filter(k => {
      const acct = accounts[k];
      const name = (acct?.dealer || k).toLowerCase();
      const city = (acct?.city || '').toLowerCase();
      const state = (acct?.state || '').toLowerCase();
      return name.includes(q) || city.includes(q) || state.includes(q);
    });
  }, [connectedAccountKeys, accounts, overviewSearch]);

  // Ref guard: prevents the global close-handler from firing in the same
  // tick as a menu-toggle button click.  React 18 delegates synthetic events
  // to the root container — e.stopPropagation() should stop native bubbling
  // to `document`, but in practice it sometimes doesn't.  The ref is our
  // belt-and-suspenders fallback.
  const menuClickRef = useRef(false);

  // Close menus on outside click
  useEffect(() => {
    const handler = () => {
      if (menuClickRef.current) {
        menuClickRef.current = false;
        return;
      }
      setOpenMenu(null);
      setFolderMenuId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Admin Overview Loading ──

  const loadOverview = useCallback(async () => {
    if (!isAdmin || connectedAccountKeys.length === 0) return;

    // Initialize loading state for all connected accounts
    const initialState: Record<string, AccountMediaPreview> = {};
    for (const key of connectedAccountKeys) {
      initialState[key] = {
        files: [],
        provider: null,
        capabilities: null,
        loading: true,
      };
    }
    setOverviewData(initialState);

    // Fetch total file counts for all connected accounts.
    // S3 is the canonical (and only) media store now — ESP media is gone.
    const results = await Promise.allSettled(
      connectedAccountKeys.map(async (key) => {
        const params = new URLSearchParams({
          accountKey: key,
          countOnly: 'true',
        });
        const res = await fetch(`/api/media?${params.toString()}`);
        const data = await res.json();

        if (res.ok) {
          return {
            accountKey: key,
            totalCount: (data.total as number) || 0,
            provider: 's3' as string | null,
            capabilities: S3_CAPABILITIES as MediaCapabilities | null,
          };
        } else {
          return {
            accountKey: key,
            totalCount: 0,
            provider: null,
            capabilities: null,
            error: data.error || 'Failed to load',
          };
        }
      })
    );

    // Update state with results
    setOverviewData(prev => {
      const updated = { ...prev };
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { accountKey: key, totalCount, provider: rowProvider, capabilities: rowCaps, error } = result.value as {
            accountKey: string;
            totalCount: number;
            provider: string | null;
            capabilities: MediaCapabilities | null;
            error?: string;
          };
          updated[key] = {
            files: [],
            totalCount,
            provider: rowProvider,
            capabilities: rowCaps,
            loading: false,
            error,
          };
        } else {
          // Promise rejected — find the account key from the index
          const idx = results.indexOf(result);
          const key = connectedAccountKeys[idx];
          if (key) {
            updated[key] = {
              files: [],
              provider: null,
              capabilities: null,
              loading: false,
              error: 'Failed to load media',
            };
          }
        }
      }
      return updated;
    });

    setOverviewLoaded(true);
  }, [isAdmin, connectedAccountKeys]);

  useEffect(() => {
    if (showOverview && !overviewLoaded && connectedAccountKeys.length > 0) {
      loadOverview();
    }
  }, [showOverview, overviewLoaded, connectedAccountKeys, loadOverview]);

  // ── Admin S3 Media Loading ──

  const loadAdminMedia = useCallback(async (searchQuery?: string) => {
    if (!isAdmin) return;
    setAdminMediaLoading(true);

    try {
      const params = new URLSearchParams({ limit: '50' });
      if (searchQuery?.trim()) params.set('search', searchQuery.trim());

      const res = await fetch(`/api/media?${params.toString()}`);
      const data = await res.json();

      if (res.ok) {
        setAdminMediaFiles(data.files || []);
        setAdminMediaTotal(data.total || 0);
      } else {
        toast.error(data.error || 'Failed to load Loomi media');
      }
    } catch {
      toast.error('Failed to load Loomi media');
    }

    setAdminMediaLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    if (showOverview) {
      loadAdminMedia();
    } else {
      setAdminMediaFiles([]);
      setAdminMediaTotal(0);
    }
  }, [showOverview, loadAdminMedia]);

  // ── Single-Account Data Loading ──

  const loadMedia = useCallback(async (cursor?: string) => {
    if (!effectiveAccountKey) return;

    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setFiles([]);
      setFolders([]);
    }

    try {
      const params = new URLSearchParams({
        accountKey: effectiveAccountKey,
      });
      if (cursor) params.set('cursor', cursor);
      // S3 media is flat; the legacy parentId scoping is a no-op here
      // but we forward it so the API can ignore/honor it without
      // changing the call surface.
      if (currentFolderId) params.set('parentId', currentFolderId);
      params.set('limit', '50');

      const res = await fetch(`/api/media?${params.toString()}`);
      const data = await res.json();

      if (res.ok) {
        const incoming = (data.files || []).map((f: MediaFile) => ({ ...f, source: 's3' as const }));

        if (cursor) {
          setFiles(prev => [...prev, ...incoming]);
        } else {
          setFiles(incoming);
          setFolders(data.folders || []);
        }
        setNextCursor(data.nextCursor || undefined);
        setProvider('s3');
        setCapabilities(S3_CAPABILITIES);
      } else {
        toast.error(data.error || 'Failed to load media');
      }
    } catch {
      toast.error('Failed to load media');
    }

    setLoading(false);
    setLoadingMore(false);
  }, [effectiveAccountKey, currentFolderId]);

  useEffect(() => {
    if (effectiveAccountKey) {
      loadMedia();
    } else {
      setFiles([]);
      setFolders([]);
      setProvider(null);
      setCapabilities(null);
      setNextCursor(undefined);
      setCurrentFolderId(undefined);
      setFolderPath([{ id: undefined, name: 'Root' }]);
    }
  }, [effectiveAccountKey, loadMedia]);

  // ── Upload ──

  const stageFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const newFiles = Array.from(fileList);
    const oversized = newFiles.filter((f) => f.size > MAX_MEDIA_FILE_SIZE);
    if (oversized.length > 0) {
      const names = oversized.map((f) => `${f.name} (${formatFileSize(f.size)})`).join(', ');
      toast.error(`${oversized.length} file${oversized.length > 1 ? 's exceed' : ' exceeds'} the 25 MB limit: ${names}`);
    }
    const valid = newFiles.filter((f) => f.size <= MAX_MEDIA_FILE_SIZE);
    if (valid.length === 0) return;
    setStagedFiles((prev) => {
      const seen = new Set(prev.map(stagedFileKey));
      const merged = [...prev];
      for (const file of valid) {
        const fingerprint = stagedFileKey(file);
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        merged.push(file);
      }
      return merged;
    });
  }, []);

  const handleUpload = async (files?: File[]) => {
    const filesToUpload = files ?? stagedFiles;
    if (filesToUpload.length === 0) return;

    setUploading(true);
    const uploadedFiles: MediaFile[] = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i];
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', 'general');
      if (effectiveAccountKey) formData.append('accountKey', effectiveAccountKey);

      try {
        const res = await fetch('/api/media', { method: 'POST', body: formData });
        const { ok, data, error } = await safeJson<{ file: MediaFile }>(res);

        if (ok && data?.file) {
          uploadedFiles.push({ ...data.file, source: 's3' });
          successCount++;
        } else {
          toast.error(`Failed to upload ${file.name}: ${error || 'Unknown error'}`);
          failCount++;
        }
      } catch {
        toast.error(`Failed to upload ${file.name}`);
        failCount++;
      }
    }

    if (uploadedFiles.length > 0) {
      if (showOverview && !effectiveAccountKey) {
        setAdminMediaFiles(prev => [...uploadedFiles, ...prev]);
        setAdminMediaTotal(prev => prev + uploadedFiles.length);
      } else {
        setFiles(prev => [...uploadedFiles, ...prev]);
      }
    }
    if (successCount > 0) {
      toast.success(`Uploaded ${successCount} file${successCount > 1 ? 's' : ''}`);
    }
    if (failCount > 0) {
      toast.error(`${failCount} upload${failCount > 1 ? 's' : ''} failed`);
    }

    setUploading(false);
    setShowUploadModal(false);
    setStagedFiles([]);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    stageFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  // ── Global file drag/drop (full-page target) ──
  useEffect(() => {
    if (!canDropUploadFiles) return;

    const onDragEnter = (e: DragEvent) => {
      if (!hasFilePayload(e.dataTransfer)) return;
      e.preventDefault();
      pageDragDepthRef.current += 1;
      setPageDragOver(true);
    };

    const onDragOverWindow = (e: DragEvent) => {
      if (!hasFilePayload(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setPageDragOver(true);
    };

    const onDragLeaveWindow = (e: DragEvent) => {
      if (!hasFilePayload(e.dataTransfer)) return;
      e.preventDefault();
      pageDragDepthRef.current = Math.max(0, pageDragDepthRef.current - 1);
      if (pageDragDepthRef.current === 0) {
        setPageDragOver(false);
      }
    };

    const onDropWindow = (e: DragEvent) => {
      if (!hasFilePayload(e.dataTransfer)) return;
      if (showUploadModal) return;
      e.preventDefault();
      pageDragDepthRef.current = 0;
      setPageDragOver(false);

      const droppedFiles = e.dataTransfer?.files || null;
      if (!droppedFiles || droppedFiles.length === 0) return;

      stageFiles(droppedFiles);

      setShowUploadModal(true);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOverWindow);
    window.addEventListener('dragleave', onDragLeaveWindow);
    window.addEventListener('drop', onDropWindow);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOverWindow);
      window.removeEventListener('dragleave', onDragLeaveWindow);
      window.removeEventListener('drop', onDropWindow);
      pageDragDepthRef.current = 0;
      setPageDragOver(false);
    };
  }, [canDropUploadFiles, showUploadModal, stageFiles]);

  // ── Rename ──

  const handleRename = async () => {
    if (!renameFile || !renameValue.trim()) return;
    setRenaming(true);

    try {
      const body: Record<string, string> = { name: renameValue.trim() };
      if (effectiveAccountKey) body.accountKey = effectiveAccountKey;

      const res = await fetch(`/api/media/${encodeURIComponent(renameFile.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (res.ok && data.file) {
        if (showOverview && !effectiveAccountKey) {
          setAdminMediaFiles(prev =>
            prev.map(f => (f.id === renameFile.id ? { ...f, ...data.file, source: 's3' as const } : f))
          );
        } else {
          setFiles(prev =>
            prev.map(f => (f.id === renameFile.id ? { ...f, ...data.file, source: 's3' as const } : f))
          );
        }
        toast.success('File renamed');
        setRenameFile(null);
      } else {
        toast.error(data.error || 'Failed to rename');
      }
    } catch {
      toast.error('Failed to rename file');
    }

    setRenaming(false);
  };

  // ── Delete ──

  const handleDelete = async () => {
    if (!deleteFile) return;
    setDeleting(true);

    try {
      const params = effectiveAccountKey ? `?accountKey=${encodeURIComponent(effectiveAccountKey)}` : '';
      const res = await fetch(
        `/api/media/${encodeURIComponent(deleteFile.id)}${params}`,
        { method: 'DELETE' },
      );
      const data = await res.json();

      if (res.ok) {
        if (showOverview && !effectiveAccountKey) {
          setAdminMediaFiles(prev => prev.filter(f => f.id !== deleteFile.id));
          setAdminMediaTotal(prev => prev - 1);
        } else {
          setFiles(prev => prev.filter(f => f.id !== deleteFile.id));
        }
        toast.success('File deleted');
        setDeleteFile(null);
      } else {
        toast.error(data.error || 'Failed to delete');
      }
    } catch {
      toast.error('Failed to delete file');
    }

    setDeleting(false);
  };

  // ── Copy URL ──

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('URL copied to clipboard');
    } catch {
      toast.error('Failed to copy URL');
    }
  };

  // ── Download File ──

  const downloadFile = (url: string, name: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleCropSave = async (crop: CropRect) => {
    const fileToCrop = cropFile;
    if (!fileToCrop?.url) return;

    setCropping(true);

    try {
      const sourceRes = await fetch(fileToCrop.url);
      if (!sourceRes.ok) {
        throw new Error('Could not load image for cropping');
      }
      const sourceBlob = await sourceRes.blob();
      const objectUrl = URL.createObjectURL(sourceBlob);

      let croppedFile: File;
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Could not decode image'));
          img.src = objectUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = crop.width;
        canvas.height = crop.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Canvas is not available in this browser');
        }

        ctx.drawImage(
          image,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          0,
          0,
          crop.width,
          crop.height,
        );

        const outputType = cropOutputMimeType(fileToCrop.type);
        const quality = outputType === 'image/jpeg' || outputType === 'image/webp' ? 0.92 : undefined;
        const croppedBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Could not encode cropped image'));
          }, outputType, quality);
        });

        croppedFile = new File(
          [croppedBlob],
          makeCroppedFileName(fileToCrop.name, outputType),
          { type: outputType },
        );
      } finally {
        URL.revokeObjectURL(objectUrl);
      }

      const formData = new FormData();
      formData.append('file', croppedFile);
      formData.append('category', 'general');
      if (effectiveAccountKey) formData.append('accountKey', effectiveAccountKey);

      const res = await fetch('/api/media', { method: 'POST', body: formData });
      const { ok, data, error } = await safeJson<{ file: MediaFile }>(res);
      if (!ok || !data?.file) {
        throw new Error(error || 'Failed to upload cropped image');
      }

      const created: MediaFile = { ...data.file, source: 's3' };
      if (showOverview && !effectiveAccountKey) {
        setAdminMediaFiles(prev => [created, ...prev]);
        setAdminMediaTotal(prev => prev + 1);
      } else {
        setFiles(prev => [created, ...prev]);
      }
      setPreviewFile(created);

      toast.success('Cropped image uploaded');
      setCropFile(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to crop image';
      toast.error(message);
    } finally {
      setCropping(false);
    }
  };

  // ── Bulk Selection ──

  const toggleSelectFile = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllFiles = () => {
    setSelectedIds(new Set(filtered.map(f => f.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectMode(false);
  };

  // ── Move ──

  const loadMoveFolders = async (parentId?: string) => {
    if (!effectiveAccountKey) return;
    setMoveLoading(true);
    try {
      const params = new URLSearchParams({ accountKey: effectiveAccountKey });
      if (parentId) params.set('parentId', parentId);
      params.set('limit', '200');
      const res = await fetch(`/api/media?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setMoveFolders(data.folders || []);
      }
    } catch {
      toast.error('Failed to load folders');
    }
    setMoveLoading(false);
  };

  const openMoveModal = (items: { id: string; type: 'file' | 'folder'; name?: string }[]) => {
    setMoveItems(items);
    setMoveFolderPath([{ id: undefined, name: 'Root' }]);
    setShowMoveModal(true);
    loadMoveFolders();
  };

  const handleMoveConfirm = async () => {
    if (!effectiveAccountKey || moveItems.length === 0) return;
    setMoving(true);

    const targetFolderId = moveFolderPath[moveFolderPath.length - 1].id;
    let successCount = 0;

    for (const item of moveItems) {
      try {
        const res = await fetch(`/api/media/${encodeURIComponent(item.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountKey: effectiveAccountKey,
            targetFolderId: targetFolderId || null,
            name: item.name,
          }),
        });
        const { ok, data, error } = await safeJson<{ error?: string }>(res);
        if (ok) {
          successCount++;
        } else {
          toast.error(data?.error || error || `Failed to move item (${res.status})`);
        }
      } catch {
        toast.error('Failed to move item');
      }
    }

    if (successCount > 0) {
      toast.success(`Moved ${successCount} item${successCount > 1 ? 's' : ''}`);
      loadMedia(); // Refresh current view
    }

    setMoving(false);
    setShowMoveModal(false);
    setMoveItems([]);
    clearSelection();
  };

  const handleBulkMove = () => {
    const items = Array.from(selectedIds).map(id => {
      const file = files.find(f => f.id === id);
      return { id, type: 'file' as const, name: file?.name };
    });
    openMoveModal(items);
  };

  // ── Bulk Delete ──

  const handleBulkDelete = async () => {
    if (!effectiveAccountKey || selectedIds.size === 0) return;
    const count = selectedIds.size;
    const confirmed = await confirm({
      title: 'Delete Files',
      message: `Delete ${count} selected file${count > 1 ? 's' : ''}? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    setDeleting(true);
    let successCount = 0;

    for (const id of selectedIds) {
      try {
        const res = await fetch(
          `/api/media/${encodeURIComponent(id)}?accountKey=${encodeURIComponent(effectiveAccountKey)}`,
          { method: 'DELETE' },
        );
        if (res.ok) successCount++;
      } catch { /* skip */ }
    }

    if (successCount > 0) {
      setFiles(prev => prev.filter(f => !selectedIds.has(f.id)));
      toast.success(`Deleted ${successCount} file${successCount > 1 ? 's' : ''}`);
    }

    setDeleting(false);
    clearSelection();
  };

  // ── Bulk Delete Admin S3 Files ──

  const handleBulkDeleteAdmin = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const confirmed = await confirm({
      title: 'Delete Loomi Files',
      message: `Delete ${count} selected file${count > 1 ? 's' : ''} from Loomi? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    setDeleting(true);
    let successCount = 0;

    for (const id of selectedIds) {
      try {
        const res = await fetch(`/api/media/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (res.ok) successCount++;
      } catch { /* skip */ }
    }

    if (successCount > 0) {
      setAdminMediaFiles(prev => prev.filter(f => !selectedIds.has(f.id)));
      setAdminMediaTotal(prev => prev - successCount);
      toast.success(`Deleted ${successCount} file${successCount > 1 ? 's' : ''}`);
    }

    setDeleting(false);
    clearSelection();
  };

  // ── Delete Folder ──

  const handleDeleteFolder = async () => {
    if (!deleteFolderItem || !effectiveAccountKey) return;
    setDeletingFolder(true);

    try {
      const res = await fetch(
        `/api/media/${encodeURIComponent(deleteFolderItem.id)}?accountKey=${encodeURIComponent(effectiveAccountKey)}`,
        { method: 'DELETE' },
      );
      const data = await res.json();

      if (res.ok) {
        setFolders(prev => prev.filter(f => f.id !== deleteFolderItem.id));
        toast.success(`Folder "${deleteFolderItem.name}" deleted`);
        setDeleteFolderItem(null);
      } else {
        toast.error(data.error || 'Failed to delete folder');
      }
    } catch {
      toast.error('Failed to delete folder');
    }

    setDeletingFolder(false);
  };

  // ── Rename Folder ──

  const handleRenameFolder = async () => {
    if (!renameFolderItem || !effectiveAccountKey) return;

    const nextName = renameFolderValue.trim();
    if (!nextName) return;
    if (nextName === renameFolderItem.name) {
      setRenameFolderItem(null);
      setRenameFolderValue('');
      return;
    }

    setRenamingFolder(true);

    try {
      const res = await fetch(`/api/media/${encodeURIComponent(renameFolderItem.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountKey: effectiveAccountKey,
          targetFolderId: renameFolderItem.parentId ?? null,
          name: nextName,
        }),
      });
      const { ok, data, error } = await safeJson<{ error?: string }>(res);

      if (ok) {
        const updatedAt = new Date().toISOString();
        setFolders((prev) => prev.map((folder) => (
          folder.id === renameFolderItem.id
            ? { ...folder, name: nextName, updatedAt }
            : folder
        )));
        setFolderPath((prev) => prev.map((crumb) => (
          crumb.id === renameFolderItem.id
            ? { ...crumb, name: nextName }
            : crumb
        )));
        setRenameFolderItem(null);
        setRenameFolderValue('');
        toast.success('Folder renamed');
      } else {
        toast.error(data?.error || error || `Failed to rename folder (${res.status})`);
      }
    } catch {
      toast.error('Failed to rename folder');
    }

    setRenamingFolder(false);
  };

  // ── Drag-and-drop into folders ──

  const handleDragStart = useCallback((e: React.DragEvent, id: string, type: 'file' | 'folder', name: string) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ id, type, name }));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleMoveDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleMoveDrop = useCallback(async (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    setDropTargetId(null);

    if (!effectiveAccountKey || !capabilities?.canMove) return;

    let dragData: { id: string; type: 'file' | 'folder'; name?: string } | null = null;
    try {
      dragData = JSON.parse(e.dataTransfer.getData('application/json'));
    } catch { return; }
    if (!dragData) return;

    // Prevent dropping a folder onto itself
    if (dragData.type === 'folder' && dragData.id === targetFolderId) return;

    try {
      const res = await fetch(`/api/media/${encodeURIComponent(dragData.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountKey: effectiveAccountKey, targetFolderId, name: dragData.name }),
      });
      const { ok, data, error } = await safeJson<{ error?: string }>(res);

      if (ok) {
        // Remove moved item from current view
        if (dragData.type === 'file') {
          setFiles(prev => prev.filter(f => f.id !== dragData!.id));
        } else {
          setFolders(prev => prev.filter(f => f.id !== dragData!.id));
        }
        toast.success('Moved successfully');
      } else {
        toast.error(data?.error || error || `Failed to move (${res.status})`);
      }
    } catch {
      toast.error('Failed to move');
    }
  }, [effectiveAccountKey, capabilities]);

  // ── Folder Navigation ──

  const navigateToFolder = useCallback((folder: MediaFolder) => {
    setCurrentFolderId(folder.id);
    setFolderPath(prev => [...prev, { id: folder.id, name: folder.name }]);
    setSearch('');
  }, []);

  // ── Create Folder ──

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !effectiveAccountKey) return;
    setCreatingFolder(true);

    try {
      const res = await fetch('/api/media/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountKey: effectiveAccountKey,
          name: newFolderName.trim(),
          parentId: currentFolderId,
        }),
      });
      const data = await res.json();

      if (res.ok && data.folder) {
        setFolders(prev => [data.folder, ...prev]);
        toast.success(`Folder "${newFolderName.trim()}" created`);
        setNewFolderName('');
        setShowNewFolderInput(false);
      } else {
        toast.error(data.error || 'Failed to create folder');
      }
    } catch {
      toast.error('Failed to create folder');
    }

    setCreatingFolder(false);
  };

  // ── Filtering ──

  const filtered = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter(f => f.name.toLowerCase().includes(q));
  }, [files, search]);

  const filteredFolders = useMemo(() => {
    if (!search.trim()) return folders;
    const q = search.toLowerCase();
    return folders.filter(f => f.name.toLowerCase().includes(q));
  }, [folders, search]);

  // ── Filtered admin media (for overview search) ──
  const filteredAdminMedia = useMemo(() => {
    if (!overviewSearch.trim()) return adminMediaFiles;
    const q = overviewSearch.toLowerCase();
    return adminMediaFiles.filter(f => f.name.toLowerCase().includes(q));
  }, [adminMediaFiles, overviewSearch]);

  useEffect(() => {
    if (!showOverview) return;
    setSelectMode(false);
    setSelectedIds(new Set());
    setOpenMenu(null);
    setOverviewSearch('');
  }, [overviewTab, showOverview]);

  // Loomi-native media is always available; gating on a provider
  // connection no longer makes sense post-ESP-teardown.
  const hasConnection = Boolean(effectiveAccountKey);
  const activeFolderName = folderPath.length > 1 ? folderPath[folderPath.length - 1]?.name : null;
  const activeAccountName = effectiveAccountKey
    ? (accounts[effectiveAccountKey]?.dealer || accountData?.dealer || effectiveAccountKey)
    : null;

  const resetToAccountRoot = useCallback(() => {
    setSearch('');
    setCurrentFolderId(undefined);
    setFolderPath([{ id: undefined, name: 'Root' }]);
  }, []);

  const jumpToFolderCrumb = useCallback((pathIndex: number) => {
    const crumb = folderPath[pathIndex];
    if (!crumb) return;
    setCurrentFolderId(crumb.id);
    setFolderPath(folderPath.slice(0, pathIndex + 1));
  }, [folderPath]);

  const backToAllAccounts = useCallback(() => {
    setAccountFilter('all');
    setSearch('');
    setOverviewSearch('');
    setCurrentFolderId(undefined);
    setFolderPath([{ id: undefined, name: 'Root' }]);
  }, [setAccountFilter]);

  // ── Render ──

  return (
    <div data-unsaved-ignore="true">
      {/* Header */}
      <div className="page-sticky-header mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <PhotoIcon className="w-7 h-7 text-[var(--primary)]" />
            <div>
              <h2 className="text-2xl font-bold">Media Library</h2>
              <div className="flex items-center gap-2 text-sm mt-0.5 flex-wrap">
                {isAdmin ? (
                  effectiveAccountKey ? (
                    <>
                      <button
                        onClick={backToAllAccounts}
                        className="text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors"
                      >
                        All Accounts
                      </button>
                      <span className="text-[var(--muted-foreground)]">{'>'}</span>
                      {activeFolderName ? (
                        <button
                          onClick={resetToAccountRoot}
                          className="text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors"
                        >
                          {activeAccountName}
                        </button>
                      ) : (
                        <span className="text-[var(--muted-foreground)]">{activeAccountName}</span>
                      )}
                      {folderPath.slice(1).map((crumb, idx) => {
                        const pathIndex = idx + 1;
                        const isLast = pathIndex === folderPath.length - 1;
                        return (
                          <span
                            key={`${crumb.id || 'root'}-${pathIndex}`}
                            className="inline-flex items-center gap-2"
                          >
                            <span className="text-[var(--muted-foreground)]">{'>'}</span>
                            {isLast ? (
                              <span className="text-[var(--muted-foreground)]">{crumb.name}</span>
                            ) : (
                              <button
                                onClick={() => jumpToFolderCrumb(pathIndex)}
                                className="text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors"
                              >
                                {crumb.name}
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </>
                  ) : (
                    <span className="text-[var(--muted-foreground)]">All Accounts</span>
                  )
                ) : effectiveAccountKey ? (
                  <>
                    {activeFolderName ? (
                      <button
                        onClick={resetToAccountRoot}
                        className="text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors"
                      >
                        {activeAccountName}
                      </button>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">{activeAccountName}</span>
                    )}
                    {folderPath.slice(1).map((crumb, idx) => {
                      const pathIndex = idx + 1;
                      const isLast = pathIndex === folderPath.length - 1;
                      return (
                        <span
                          key={`${crumb.id || 'root'}-${pathIndex}`}
                          className="inline-flex items-center gap-2"
                        >
                          <span className="text-[var(--muted-foreground)]">{'>'}</span>
                          {isLast ? (
                            <span className="text-[var(--muted-foreground)]">{crumb.name}</span>
                          ) : (
                            <button
                              onClick={() => jumpToFolderCrumb(pathIndex)}
                              className="text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors"
                            >
                              {crumb.name}
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </>
                ) : (
                  <span className="text-[var(--muted-foreground)]">Manage your media files</span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons in header */}
          <div className="flex items-center gap-2">
            {showOverview && (
              <PrimaryButton
                onClick={() => {
                  setStagedFiles([]);
                  setShowUploadModal(true);
                }}
                disabled={uploading}
              >
                <ArrowUpTrayIcon className="w-4 h-4" />
                {uploading ? 'Uploading...' : 'Add Media'}
              </PrimaryButton>
            )}
            {effectiveAccountKey && (
              <>
                {capabilities?.canCreateFolders && (
                  <button
                    onClick={() => {
                      setNewFolderName('');
                      setShowNewFolderInput(true);
                    }}
                    className="inline-flex items-center gap-2 h-10 px-3 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)] transition-colors"
                  >
                    <FolderPlusIcon className="w-4 h-4" />
                    New Folder
                  </button>
                )}
                <PrimaryButton
                  onClick={() => { setStagedFiles([]); setShowUploadModal(true); }}
                  disabled={uploading}
                >
                  <ArrowUpTrayIcon className="w-4 h-4" />
                  {uploading ? 'Uploading...' : 'Add Media'}
                </PrimaryButton>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Admin Overview Mode ── */}
      {showOverview && (
        <>
          {/* Hidden file input for uploads (overview mode) */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => { stageFiles(e.target.files); if (e.target) e.target.value = ''; }}
            className="hidden"
            id="media-upload-input"
          />

          {/* Overview tabs */}
          <div className="flex items-center gap-1 mb-4 border-b border-[var(--border)]">
            <button
              onClick={() => setOverviewTab('subaccounts')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                overviewTab === 'subaccounts'
                  ? 'border-[var(--primary)] text-[var(--primary)]'
                  : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              Sub-account Media
            </button>
            <button
              onClick={() => setOverviewTab('loomi')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                overviewTab === 'loomi'
                  ? 'border-[var(--primary)] text-[var(--primary)]'
                  : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              Loomi Media
            </button>
          </div>

          {/* Overview toolbar: search + buttons */}
          <div className="flex items-center justify-between mb-4 gap-3">
            <div className="relative flex-1 max-w-xs">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                type="text"
                value={overviewSearch}
                onChange={(e) => setOverviewSearch(e.target.value)}
                className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-[var(--foreground)]"
                placeholder={isLoomiOverviewTab ? 'Search Loomi media...' : 'Search sub-accounts...'}
              />
            </div>
            {isLoomiOverviewTab && adminMediaFiles.length > 0 && !selectMode && (
              <button
                onClick={() => { setSelectMode(true); setSelectedIds(new Set()); }}
                className="inline-flex items-center gap-2 h-10 px-3 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <img src="/icons/select-checkbox.svg" alt="" aria-hidden className="w-3.5 h-3.5 invert opacity-80" />
                Select
              </button>
            )}
          </div>

          {/* ── Loomi Media Library section ── */}
          {isLoomiOverviewTab && adminMediaLoading && adminMediaFiles.length === 0 && (
            <div className="mb-8">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="glass-card rounded-xl animate-pulse">
                    <div className="h-[140px] rounded-t-xl bg-[var(--muted)]" />
                    <div className="p-3 space-y-2">
                      <div className="h-3 bg-[var(--muted)] rounded w-16" />
                      <div className="h-3 bg-[var(--muted)] rounded w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isLoomiOverviewTab && !adminMediaLoading && filteredAdminMedia.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center justify-end mb-3">
                <p className="text-xs text-[var(--muted-foreground)]">
                  {filteredAdminMedia.length} file{filteredAdminMedia.length !== 1 ? 's' : ''}
                  {adminMediaTotal > filteredAdminMedia.length && ` of ${adminMediaTotal}`}
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                {filteredAdminMedia.map(f => {
                  const itemKey = mediaItemKey(f);
                  return (
                    <MediaCard
                      key={itemKey}
                      f={f}
                      isMenuOpen={openMenu === itemKey}
                      isSelected={selectedIds.has(f.id)}
                      selectMode={selectMode}
                      provider="s3"
                      capabilities={S3_CAPABILITIES}
                      menuClickRef={menuClickRef}
                      onMenuToggle={() => setOpenMenu(prev => prev === itemKey ? null : itemKey)}
                      onMenuClose={() => setOpenMenu(null)}
                      onSelect={() => toggleSelectFile(f.id)}
                      onPreview={() => setPreviewFile(f)}
                      onCopyUrl={() => copyUrl(f.url)}
                      onDownload={() => downloadFile(f.url, f.name)}
                      onRename={() => { setRenameValue(f.name); setRenameFile(f); }}
                      onDelete={() => setDeleteFile(f)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {isLoomiOverviewTab && !adminMediaLoading && filteredAdminMedia.length === 0 && (
            <div className="text-center py-16 text-[var(--muted-foreground)]">
              <PhotoIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium mb-1">
                {overviewSearch.trim() ? 'No Loomi media match your search' : 'No Loomi media files yet'}
              </p>
              <p className="text-xs">
                {overviewSearch.trim()
                  ? 'Try a different search term.'
                  : 'Upload files to Loomi to build your shared media library.'}
              </p>
            </div>
          )}

          {/* ── Sub-account cards section ── */}
          {isSubAccountOverviewTab && connectedAccountKeys.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">Sub-account Media</h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {filteredOverviewKeys.length} account{filteredOverviewKeys.length !== 1 ? 's' : ''}
                  {overviewSearch && ` matching "${overviewSearch}"`}
                </p>
              </div>
              {filteredOverviewKeys.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredOverviewKeys.map(key => (
                    <AccountCard
                      key={key}
                      acctKey={key}
                      acctData={accounts[key]}
                      overviewRow={overviewData[key]}
                      onSelect={() => { setAccountFilter(key); setSearch(''); clearSelection(); }}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-[var(--muted-foreground)]">
                  <MagnifyingGlassIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No sub-accounts match &quot;{overviewSearch}&quot;</p>
                </div>
              )}
            </>
          )}
          {isSubAccountOverviewTab && connectedAccountKeys.length === 0 && (
            <div className="text-center py-16 text-[var(--muted-foreground)]">
              <PhotoIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium mb-1">No connected sub-accounts</p>
              <p className="text-xs">Connect an integration in account settings to view sub-account media.</p>
            </div>
          )}
        </>
      )}

      {/* ── Single-Account Detail Mode ── */}
      {!showOverview && (
        <>
          {/* Hidden file input for uploads */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => { stageFiles(e.target.files); if (e.target) e.target.value = ''; }}
            className="hidden"
            id="media-upload-input"
          />

          {/* Toolbar */}
          {effectiveAccountKey && (hasConnection || isAdmin) && (
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-1">
                <div className="relative flex-1 max-w-xs">
                  <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-[var(--foreground)]"
                    placeholder="Search files..."
                  />
                </div>
                {/* Select mode toggle */}
                {capabilities?.canMove && filtered.length > 0 && (
                  <button
                    onClick={() => { setSelectMode(prev => !prev); setSelectedIds(new Set()); }}
                    className={`inline-flex items-center gap-2 h-10 px-3 text-sm rounded-lg border transition-colors ${
                      selectMode
                        ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                        : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
                    }`}
                  >
                    <img src="/icons/select-checkbox.svg" alt="" aria-hidden className="w-3.5 h-3.5 invert opacity-80" />
                    {selectMode ? 'Cancel' : 'Select'}
                  </button>
                )}
                {/* View mode toggle */}
                <div className="flex items-center rounded-lg border border-[var(--border)] overflow-hidden">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-[var(--muted)] text-[var(--foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
                    title="Grid view"
                  >
                    <Squares2X2Icon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-[var(--muted)] text-[var(--foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
                    title="List view"
                  >
                    <ListBulletIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                {loading ? 'Loading...' : (
                  <>
                    {filteredFolders.length > 0 && `${filteredFolders.length} folder${filteredFolders.length !== 1 ? 's' : ''}, `}
                    {`${filtered.length} file${filtered.length !== 1 ? 's' : ''}`}
                  </>
                )}
                {search && ` matching "${search}"`}
              </p>
            </div>
          )}

          {/* Account mode: no account selected */}
          {!isAdmin && !effectiveAccountKey && (
            <div className="text-center py-16 text-[var(--muted-foreground)]">
              <PhotoIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select an account to view its media files.</p>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => (
                <div key={i} className="glass-card rounded-xl animate-pulse">
                  <div className="h-[140px] rounded-t-xl bg-[var(--muted)]" />
                  <div className="p-3 space-y-2">
                    <div className="h-3 bg-[var(--muted)] rounded w-16" />
                    <div className="h-3 bg-[var(--muted)] rounded w-3/4" />
                    <div className="h-2 bg-[var(--muted)] rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && effectiveAccountKey && (hasConnection || isAdmin) && filtered.length === 0 && filteredFolders.length === 0 && (
            <div className="text-center py-16 text-[var(--muted-foreground)]">
              <PhotoIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
              {files.length === 0 && folders.length === 0 ? (
                <>
                  <p className="text-sm font-medium mb-1">
                    {currentFolderId ? 'This folder is empty' : 'No media files yet'}
                  </p>
                  <p className="text-xs">Click &quot;Upload Media&quot; to upload files.</p>
                </>
              ) : (
                <p className="text-sm">No files match your search.</p>
              )}
            </div>
          )}

          {/* Folder grid */}
          {!loading && filteredFolders.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 mt-8 mb-10">
              {filteredFolders.map(folder => (
                <div
                  key={folder.id}
                  className={`glass-card rounded-xl p-5 text-left group hover:ring-1 hover:ring-[var(--primary)]/30 transition-all animate-fade-in-up relative ${folderMenuId === folder.id ? 'z-30' : 'z-0'} ${
                    capabilities?.canMove ? 'cursor-grab active:cursor-grabbing' : ''
                  } ${dropTargetId === folder.id ? 'ring-2 ring-[var(--primary)] bg-[var(--primary)]/10 scale-[1.02] shadow-lg shadow-[var(--primary)]/20' : ''}`}
                  draggable={!!capabilities?.canMove}
                  onDragStart={(e) => handleDragStart(e, folder.id, 'folder', folder.name)}
                  onDragOver={handleMoveDragOver}
                  onDragEnter={(e) => { e.preventDefault(); setDropTargetId(folder.id); }}
                  onDragLeave={(e) => {
                    // Only clear if we truly left the folder card (not entering a child)
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTargetId(null);
                  }}
                  onDrop={(e) => handleMoveDrop(e, folder.id)}
                >
                  <div
                    className="flex items-center gap-3 cursor-pointer"
                    onClick={() => navigateToFolder(folder)}
                  >
                    <div className="w-10 h-10 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center flex-shrink-0">
                      <FolderIcon className="w-5 h-5 text-[var(--primary)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3
                        className="text-xs font-semibold truncate"
                        title={folder.name}
                      >
                        {folder.name}
                      </h3>
                      <span className="text-[10px] text-[var(--muted-foreground)]">
                        {timeAgo(folder.createdAt)}
                      </span>
                    </div>
                  </div>
                  {/* Folder context menu button */}
                  {(capabilities?.canMove || capabilities?.canDelete) && (
                    <div className="absolute top-2 right-2">
                      <button
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          menuClickRef.current = true;
                          setFolderMenuId(prev => prev === folder.id ? null : folder.id);
                        }}
                        className={`p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors ${folderMenuId === folder.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                      >
                        <EllipsisVerticalIcon className="w-4 h-4" />
                      </button>
                      {folderMenuId === folder.id && (
                        <div className="absolute right-0 top-full mt-1 z-50 w-40 glass-dropdown" onMouseDown={(e) => { e.stopPropagation(); menuClickRef.current = true; }}>
                          {capabilities?.canMove && (
                            <button
                              onClick={() => {
                                setFolderMenuId(null);
                                setRenameFolderItem(folder);
                                setRenameFolderValue(folder.name);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                            >
                              <PencilSquareIcon className="w-4 h-4" /> Rename
                            </button>
                          )}
                          {capabilities?.canMove && (
                            <button
                              onClick={() => { setFolderMenuId(null); openMoveModal([{ id: folder.id, type: 'folder', name: folder.name }]); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                            >
                              <FolderArrowDownIcon className="w-4 h-4" /> Move
                            </button>
                          )}
                          {capabilities?.canDelete && (
                            <button
                              onClick={() => { setFolderMenuId(null); setDeleteFolderItem(folder); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                            >
                              <TrashIcon className="w-4 h-4" /> Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Media grid / list */}
          {!loading && filtered.length > 0 && (
            <div className={viewMode === 'list'
              ? 'flex flex-col gap-1.5'
              : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3'
            }>
              {filtered.map(f => {
                const itemKey = mediaItemKey(f);
                const ItemComponent = viewMode === 'list' ? MediaListRow : MediaCard;
                return (
                  <ItemComponent
                    key={itemKey}
                    f={f}
                    isMenuOpen={openMenu === itemKey}
                    isSelected={selectedIds.has(f.id)}
                    selectMode={selectMode}
                    provider={provider}
                    capabilities={capabilities}
                    menuClickRef={menuClickRef}
                    draggable={!!capabilities?.canMove}
                    onDragStart={(e) => handleDragStart(e, f.id, 'file', f.name)}
                    onMenuToggle={() => setOpenMenu(prev => prev === itemKey ? null : itemKey)}
                    onMenuClose={() => setOpenMenu(null)}
                    onSelect={() => toggleSelectFile(f.id)}
                    onPreview={() => setPreviewFile(f)}
                    onCopyUrl={() => copyUrl(f.url)}
                    onDownload={() => downloadFile(f.url, f.name)}
                    onMove={capabilities?.canMove ? () => openMoveModal([{ id: f.id, type: 'file', name: f.name }]) : undefined}
                    onRename={capabilities?.canRename ? () => { setRenameValue(f.name); setRenameFile(f); } : undefined}
                    onDelete={capabilities?.canDelete ? () => setDeleteFile(f) : undefined}
                  />
                );
              })}
            </div>
          )}

          {/* Load More */}
          {!loading && nextCursor && (
            <div className="text-center mt-6">
              <button
                onClick={() => loadMedia(nextCursor)}
                disabled={loadingMore}
                className="px-6 py-2.5 text-sm font-medium border border-[var(--border)] text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
              >
                {loadingMore ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}

      {showOverview && isLoomiOverviewTab && selectMode && (
        <BulkActionDock
          count={selectedIds.size}
          itemLabel="files"
          onClose={clearSelection}
          actions={[
            {
              id: 'select-all',
              label: selectedIds.size === filteredAdminMedia.length ? 'Deselect all' : 'Select all',
              icon: <CheckIcon className="h-4 w-4" />,
              onClick: () => {
                if (selectedIds.size === filteredAdminMedia.length) {
                  setSelectedIds(new Set());
                  return;
                }
                setSelectedIds(new Set(filteredAdminMedia.map((file) => file.id)));
              },
              disabled: filteredAdminMedia.length === 0,
            },
            {
              id: 'delete',
              label: 'Delete',
              icon: <TrashIcon className="h-4 w-4" />,
              onClick: handleBulkDeleteAdmin,
              disabled: selectedIds.size === 0 || deleting,
              danger: true,
            },
          ]}
        />
      )}

      {!showOverview && selectMode && (
        <BulkActionDock
          count={selectedIds.size}
          itemLabel="files"
          onClose={clearSelection}
          actions={[
            {
              id: 'select-all',
              label: selectedIds.size === filtered.length ? 'Deselect all' : 'Select all',
              icon: <CheckIcon className="h-4 w-4" />,
              onClick: () => {
                if (selectedIds.size === filtered.length) {
                  setSelectedIds(new Set());
                  return;
                }
                selectAllFiles();
              },
              disabled: filtered.length === 0,
            },
            {
              id: 'move',
              label: 'Move',
              icon: <FolderArrowDownIcon className="h-4 w-4" />,
              onClick: handleBulkMove,
              disabled: !capabilities?.canMove || selectedIds.size === 0,
            },
            {
              id: 'delete',
              label: 'Delete',
              icon: <TrashIcon className="h-4 w-4" />,
              onClick: handleBulkDelete,
              disabled: !capabilities?.canDelete || selectedIds.size === 0 || deleting,
              danger: true,
            },
          ]}
        />
      )}

      {showNewFolderInput && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in"
          onClick={() => {
            if (creatingFolder) return;
            setShowNewFolderInput(false);
            setNewFolderName('');
          }}
        >
          <div className="glass-modal w-[440px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">New Folder</h3>
              <button
                onClick={() => { setShowNewFolderInput(false); setNewFolderName(''); }}
                disabled={creatingFolder}
                className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCreateFolder();
                  }
                  if (e.key === 'Escape' && !creatingFolder) {
                    e.preventDefault();
                    setShowNewFolderInput(false);
                    setNewFolderName('');
                  }
                }}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
                placeholder="Folder name"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
              <button
                onClick={() => { setShowNewFolderInput(false); setNewFolderName(''); }}
                disabled={creatingFolder}
                className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleCreateFolder(); }}
                disabled={creatingFolder || !newFolderName.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--primary)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {creatingFolder ? 'Creating...' : 'Create Folder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rename Modal ── */}
      {renameFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={() => setRenameFile(null)}>
          <div className="glass-modal w-[420px]" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">Rename File</h3>
            </div>
            <div className="p-5">
              <label className="block text-sm text-[var(--muted-foreground)] mb-2">File name</label>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); }}
                className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
              <button
                onClick={() => setRenameFile(null)}
                className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                disabled={renaming || !renameValue.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--primary)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {renaming ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {renameFolderItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in"
          onClick={() => {
            if (renamingFolder) return;
            setRenameFolderItem(null);
            setRenameFolderValue('');
          }}
        >
          <div className="glass-modal w-[420px]" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">Rename Folder</h3>
            </div>
            <div className="p-5">
              <label className="block text-sm text-[var(--muted-foreground)] mb-2">Folder name</label>
              <input
                type="text"
                value={renameFolderValue}
                onChange={(e) => setRenameFolderValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameFolder(); }}
                className="w-full text-sm bg-[var(--input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)]"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
              <button
                onClick={() => {
                  setRenameFolderItem(null);
                  setRenameFolderValue('');
                }}
                disabled={renamingFolder}
                className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRenameFolder}
                disabled={renamingFolder || !renameFolderValue.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--primary)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {renamingFolder ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={() => setDeleteFile(null)}>
          <div className="glass-modal w-[420px]" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">Delete File</h3>
            </div>
            <div className="p-5">
              <p className="text-sm text-[var(--foreground)]">
                Are you sure you want to delete <strong>{deleteFile.name}</strong>?
              </p>
              <p className="text-xs text-[var(--muted-foreground)] mt-2">
                This will permanently remove the file from {deleteFile.source === 's3' ? 'Loomi' : provider ? providerLabel(provider) : 'the connected platform'}. This action cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
              <button
                onClick={() => setDeleteFile(null)}
                className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Upload Modal ── */}
      {showUploadModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in"
          onClick={() => !uploading && setShowUploadModal(false)}
          onKeyDown={(e) => { if (e.key === 'Escape' && !uploading) setShowUploadModal(false); }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div
            className="glass-modal w-[520px] max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">Upload Media</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Drop zone */}
              <div
                className={`border-2 border-dashed rounded-xl ${stagedFiles.length > 0 ? 'p-5' : 'p-10'} text-center transition-all cursor-pointer ${
                  dragOver
                    ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                    : 'border-[var(--border)] hover:border-[var(--primary)]/50'
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <div className="flex flex-col items-center gap-2 text-[var(--primary)]">
                    <ArrowUpTrayIcon className="w-8 h-8 animate-bounce" />
                    <span className="text-sm font-medium">Uploading...</span>
                  </div>
                ) : (
                  <>
                    <ArrowUpTrayIcon className={`${stagedFiles.length > 0 ? 'w-6 h-6 mb-1' : 'w-10 h-10 mb-3'} mx-auto text-[var(--muted-foreground)]`} />
                    <p className={`${stagedFiles.length > 0 ? 'text-xs' : 'text-sm'} text-[var(--foreground)] font-medium mb-0.5`}>
                      {stagedFiles.length > 0 ? 'Drop more files or click to add' : 'Drop files here or click to browse'}
                    </p>
                    <p className="text-[10px] text-[var(--muted-foreground)]">Max file size: 25 MB</p>
                  </>
                )}
              </div>

              {/* Staged files list */}
              {stagedFiles.length > 0 && !uploading && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-[var(--muted-foreground)]">
                      {stagedFiles.length} file{stagedFiles.length !== 1 ? 's' : ''} ready
                    </p>
                    <button
                      onClick={() => setStagedFiles([])}
                      className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {stagedFiles.map((file, idx) => (
                      <div key={`${file.name}-${idx}`} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--muted)]/50 group">
                        {file.type.startsWith('image/') ? (
                          <img
                            src={URL.createObjectURL(file)}
                            alt=""
                            className="w-7 h-7 rounded object-cover flex-shrink-0 border border-[var(--border)]"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded bg-[var(--muted)] flex items-center justify-center flex-shrink-0 border border-[var(--border)]">
                            <ArrowUpTrayIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate">{file.name}</p>
                          <p className="text-[10px] text-[var(--muted-foreground)]">{formatFileSize(file.size)}</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setStagedFiles((prev) => prev.filter((_, i) => i !== idx)); }}
                          className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <XMarkIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Upload action footer */}
            {stagedFiles.length > 0 && (
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
                <button
                  onClick={() => { setStagedFiles([]); setShowUploadModal(false); }}
                  disabled={uploading}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleUpload()}
                  disabled={uploading || stagedFiles.length === 0}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {uploading
                    ? 'Uploading...'
                    : `Upload ${stagedFiles.length} file${stagedFiles.length !== 1 ? 's' : ''}`
                  }
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Delete Folder Confirmation Modal ── */}
      {deleteFolderItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in" onClick={() => setDeleteFolderItem(null)}>
          <div className="glass-modal w-[420px]" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold">Delete Folder</h3>
            </div>
            <div className="p-5">
              <p className="text-sm text-[var(--foreground)]">
                Are you sure you want to delete <strong>{deleteFolderItem.name}</strong>?
              </p>
              <p className="text-xs text-[var(--muted-foreground)] mt-2">
                This will permanently remove the folder and all its contents from {provider ? providerLabel(provider) : 'the connected platform'}. This action cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
              <button
                onClick={() => setDeleteFolderItem(null)}
                className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteFolder}
                disabled={deletingFolder}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {deletingFolder ? 'Deleting...' : 'Delete Folder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Move Modal (Folder Picker) ── */}
      {showMoveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-overlay-in"
          onClick={() => !moving && setShowMoveModal(false)}
          onKeyDown={(e) => { if (e.key === 'Escape' && !moving) setShowMoveModal(false); }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div className="glass-modal w-[480px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div>
                <h3 className="text-base font-semibold">Move to Folder</h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  {moveItems.length} item{moveItems.length > 1 ? 's' : ''} selected
                </p>
              </div>
              <button
                onClick={() => setShowMoveModal(false)}
                className="p-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Breadcrumb */}
            <div className="flex items-center gap-1 px-5 py-2 border-b border-[var(--border)] text-xs flex-wrap">
              {moveFolderPath.map((crumb, idx) => {
                const isLast = idx === moveFolderPath.length - 1;
                return (
                  <span key={crumb.id ?? 'root'} className="flex items-center gap-1">
                    {idx > 0 && <ChevronRightIcon className="w-3 h-3 text-[var(--muted-foreground)]" />}
                    {isLast ? (
                      <span className="font-medium text-[var(--foreground)] flex items-center gap-1">
                        {idx === 0 ? <HomeIcon className="w-3 h-3" /> : <FolderIcon className="w-3 h-3" />}
                        {crumb.name}
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          const newPath = moveFolderPath.slice(0, idx + 1);
                          setMoveFolderPath(newPath);
                          loadMoveFolders(crumb.id);
                        }}
                        className="flex items-center gap-1 text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors"
                      >
                        {idx === 0 ? <HomeIcon className="w-3 h-3" /> : <FolderIcon className="w-3 h-3" />}
                        {crumb.name}
                      </button>
                    )}
                  </span>
                );
              })}
            </div>

            {/* Folder list */}
            <div className="flex-1 overflow-y-auto p-3 min-h-[200px]">
              {moveLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-pulse text-sm text-[var(--muted-foreground)]">Loading folders...</div>
                </div>
              ) : moveFolders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-[var(--muted-foreground)]">
                  <FolderIcon className="w-8 h-8 opacity-30 mb-2" />
                  <p className="text-xs">No subfolders here</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {moveFolders
                    .filter(mf => !moveItems.some(mi => mi.id === mf.id))
                    .map(mf => (
                    <button
                      key={mf.id}
                      onClick={() => {
                        const newPath = [...moveFolderPath, { id: mf.id, name: mf.name }];
                        setMoveFolderPath(newPath);
                        loadMoveFolders(mf.id);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-[var(--muted)] transition-colors"
                    >
                      <FolderIcon className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{mf.name}</span>
                      <ChevronRightIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] ml-auto flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-[var(--border)]">
              <p className="text-xs text-[var(--muted-foreground)]">
                Move to: <strong>{moveFolderPath[moveFolderPath.length - 1].name}</strong>
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowMoveModal(false)}
                  className="px-4 py-2 text-sm font-medium text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMoveConfirm}
                  disabled={moving}
                  className="px-4 py-2 text-sm font-medium text-white bg-[var(--primary)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {moving ? 'Moving...' : 'Move Here'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {cropFile && (
        <CropEditorModal
          file={cropFile}
          saving={cropping}
          onClose={() => { if (!cropping) setCropFile(null); }}
          onSave={handleCropSave}
        />
      )}

      {/* ── Image Preview Modal ── */}
      {previewFile && (() => {
        const previewIsImage = previewFile.type?.startsWith('image') || previewFile.url?.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
        // Use the correct file list for navigation based on context
        const previewList = showOverview ? filteredAdminMedia : filtered;
        const currentIndex = previewList.findIndex(f => f.id === previewFile.id);
        const hasPrev = currentIndex > 0;
        const hasNext = currentIndex < previewList.length - 1;

        const goPrev = () => { if (hasPrev) setPreviewFile(previewList[currentIndex - 1]); };
        const goNext = () => { if (hasNext) setPreviewFile(previewList[currentIndex + 1]); };

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-overlay-in"
            onClick={() => setPreviewFile(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPreviewFile(null);
              if (e.key === 'ArrowLeft') goPrev();
              if (e.key === 'ArrowRight') goNext();
            }}
            tabIndex={-1}
            ref={(el) => el?.focus()}
          >
            <div className="glass-modal w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
                <div className="flex items-center gap-3 min-w-0">
                  <PhotoIcon className="w-5 h-5 text-[var(--muted-foreground)] flex-shrink-0" />
                  <h3 className="text-sm font-semibold truncate" title={previewFile.name}>
                    {previewFile.name}
                  </h3>
                  {currentIndex >= 0 && (
                    <span className="text-[10px] text-[var(--muted-foreground)] flex-shrink-0">
                      {currentIndex + 1} / {previewList.length}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex-shrink-0"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>

              {/* Image */}
              <div className="flex-1 overflow-hidden flex items-center justify-center bg-black/20 relative min-h-0">
                {previewIsImage && previewFile.url ? (
                  <img
                    src={previewFile.url}
                    alt={previewFile.name}
                    className="max-w-full max-h-[70vh] object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-[var(--muted-foreground)]">
                    <PhotoIcon className="w-16 h-16 opacity-30 mb-3" />
                    <p className="text-sm">Preview not available</p>
                  </div>
                )}

                {/* Prev/Next navigation */}
                {hasPrev && (
                  <button
                    onClick={(e) => { e.stopPropagation(); goPrev(); }}
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
                  >
                    <ArrowLeftIcon className="w-5 h-5" />
                  </button>
                )}
                {hasNext && (
                  <button
                    onClick={(e) => { e.stopPropagation(); goNext(); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
                  >
                    <ArrowRightIcon className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-[var(--border)]">
                <div className="flex items-center gap-3 text-[10px] text-[var(--muted-foreground)]">
                  {provider && <ProviderPill prov={provider} />}
                  {previewFile.size != null && <span>{formatFileSize(previewFile.size)}</span>}
                  {previewFile.createdAt && <span>{timeAgo(previewFile.createdAt)}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {previewIsImage && (
                    <button
                      onClick={() => setCropFile(previewFile)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[var(--border)] text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                    >
                      <CropIcon className="w-3.5 h-3.5" /> Crop
                    </button>
                  )}
                  <button
                    onClick={() => copyUrl(previewFile.url)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[var(--border)] text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                  >
                    <Square2StackIcon className="w-3.5 h-3.5" /> Copy URL
                  </button>
                  {capabilities?.canDelete && (
                    <button
                      onClick={() => { setPreviewFile(null); setDeleteFile(previewFile); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors"
                    >
                      <TrashIcon className="w-3.5 h-3.5" /> Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Global file drop overlay ── */}
      {pageDragOver && !showUploadModal && canDropUploadFiles && (
        <div className="fixed inset-0 z-[60] pointer-events-none">
          <div className="absolute inset-0 bg-[var(--primary)]/8 backdrop-blur-[1px]" />
          <div className="absolute inset-4 rounded-2xl border-2 border-dashed border-[var(--primary)] bg-[var(--primary)]/10 flex items-center justify-center">
            <div className="text-center px-6">
              <ArrowUpTrayIcon className="w-10 h-10 mx-auto text-[var(--primary)] mb-3" />
              <p className="text-base font-semibold text-[var(--foreground)]">Drop files to upload</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">
                Files will be added to the upload queue.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
