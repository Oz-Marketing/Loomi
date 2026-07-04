'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

/** Crop rectangle. On the wire (to onSave) x/y/width/height are NATURAL pixels;
 *  internally the modal tracks them as 0..1 fractions of the displayed image. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The image being cropped — a media file, an ad-builder element image, etc. */
export interface CropTarget {
  url?: string;
  name: string;
  type?: string;
}

type CropResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type CropInteraction =
  | { mode: 'draw' | 'move'; startPoint: { x: number; y: number }; originCrop: CropRect }
  | { mode: 'resize'; startPoint: { x: number; y: number }; originCrop: CropRect; handle: CropResizeHandle };

const MIN_CROP_SIZE = 0.02;

const FREE_CROP_HANDLES: Array<{ id: CropResizeHandle; className: string; cursorClassName: string }> = [
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
  if (!aspectRatio) return { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  const maxWidth = 0.82;
  const maxHeight = 0.82;
  let width = maxWidth;
  let height = width / aspectRatio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspectRatio;
  }
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

function computeDragCrop(start: { x: number; y: number }, end: { x: number; y: number }, aspectRatio: number | null): CropRect {
  if (!aspectRatio) {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    return {
      x: clampNumber(x, 0, 1),
      y: clampNumber(y, 0, 1),
      width: clampNumber(Math.abs(end.x - start.x), 0, 1),
      height: clampNumber(Math.abs(end.y - start.y), 0, 1),
    };
  }
  const dragRight = end.x >= start.x;
  const dragDown = end.y >= start.y;
  let width = Math.abs(end.x - start.x);
  let maxWidth = clampNumber(dragRight ? 1 - start.x : start.x, 0, 1);
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

function moveCropRect(crop: CropRect, deltaX: number, deltaY: number): CropRect {
  return {
    x: clampNumber(crop.x + deltaX, 0, Math.max(0, 1 - crop.width)),
    y: clampNumber(crop.y + deltaY, 0, Math.max(0, 1 - crop.height)),
    width: crop.width,
    height: crop.height,
  };
}

function resizeFreeCropRect(crop: CropRect, handle: CropResizeHandle, point: { x: number; y: number }): CropRect {
  let left = crop.x;
  let right = crop.x + crop.width;
  let top = crop.y;
  let bottom = crop.y + crop.height;
  if (handle.includes('w')) left = clampNumber(point.x, 0, right - MIN_CROP_SIZE);
  if (handle.includes('e')) right = clampNumber(point.x, left + MIN_CROP_SIZE, 1);
  if (handle.includes('n')) top = clampNumber(point.y, 0, bottom - MIN_CROP_SIZE);
  if (handle.includes('s')) bottom = clampNumber(point.y, top + MIN_CROP_SIZE, 1);
  return {
    x: left,
    y: top,
    width: clampNumber(right - left, MIN_CROP_SIZE, 1),
    height: clampNumber(bottom - top, MIN_CROP_SIZE, 1),
  };
}

function CropIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className={className} fill="currentColor" aria-hidden="true">
      <path d="M 11.970703 3.9726562 A 2.0002 2.0002 0 0 0 10 6 L 10 10 L 6 10 A 2.0002 2.0002 0 1 0 6 14 L 10 14 L 10 31 C 10 34.842251 13.157749 38 17 38 L 34 38 L 34 42 A 2.0002 2.0002 0 1 0 38 42 L 38 38 L 42 38 A 2.0002 2.0002 0 1 0 42 34 L 17 34 C 15.320251 34 14 32.679749 14 31 L 14 6 A 2.0002 2.0002 0 0 0 11.970703 3.9726562 z M 16 10 L 16 14 L 31 14 C 32.679749 14 34 15.320251 34 17 L 34 32 L 38 32 L 38 17 C 38 13.157749 34.842251 10 31 10 L 16 10 z" />
    </svg>
  );
}

interface CropEditorModalProps {
  file: CropTarget;
  saving: boolean;
  onClose: () => void;
  /** Receives the crop in NATURAL image pixels. */
  onSave: (crop: CropRect) => void;
  /** Label for the confirm button while idle (default "Crop & Save"). */
  confirmLabel?: string;
}

/**
 * Set-the-boundaries image cropper used by BOTH the media library and the ad
 * builder. Draw a box on the image (or pick an aspect preset), drag/resize it,
 * and apply — the caller does the actual crop (server-side). Pure UI; no fetch.
 */
export function CropEditorModal({ file, saving, onClose, onSave, confirmLabel = 'Crop & Save' }: CropEditorModalProps) {
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
    beginInteraction({ mode: 'draw', startPoint: point, originCrop: crop });
  };

  const handleSelectionMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (saving || !hasSelection) return;
    const point = getPoint(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    beginInteraction({ mode: 'move', startPoint: point, originCrop: crop });
  };

  const handleResizeHandleMouseDown = (handle: CropResizeHandle) => (event: React.MouseEvent<HTMLButtonElement>) => {
    if (saving) return;
    const point = getPoint(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    beginInteraction({ mode: 'resize', startPoint: point, originCrop: crop, handle });
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
        setCrop(moveCropRect(interaction.originCrop, point.x - interaction.startPoint.x, point.y - interaction.startPoint.y));
        return;
      }
      if (interaction.mode === 'resize' && aspectRatio === null) {
        setCrop(resizeFreeCropRect(interaction.originCrop, interaction.handle, point));
      }
    };
    const handleMouseUp = () => {
      if (!interactionRef.current) return;
      if (!dragMovedRef.current) setCrop(cropBeforeDragRef.current);
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
      if (event.key === 'Escape' && !saving) onClose();
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
    onSave({ x: safeX, y: safeY, width: safeWidth, height: safeHeight });
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 animate-overlay-in"
      onClick={() => { if (!saving) onClose(); }}
    >
      <div className="glass-modal w-full max-w-5xl max-h-[92vh] flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Crop Image</h3>
            <p className="text-[11px] text-[var(--muted-foreground)] truncate mt-0.5" title={file.name}>{file.name}</p>
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
              <div ref={imageWrapRef} onMouseDown={handleImageMouseDown} className="relative inline-block cursor-crosshair select-none touch-none">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={file.url}
                  alt={file.name}
                  className="block max-w-full max-h-[60vh] object-contain pointer-events-none"
                  onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
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
            {saving ? 'Cropping…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
