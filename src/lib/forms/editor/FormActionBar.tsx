'use client';

import * as React from 'react';
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  ListBulletIcon,
  CheckIcon,
  ClipboardIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';

export type PreviewWidth = 'desktop' | 'mobile';

export interface FormActionBarProps {
  previewWidth: PreviewWidth;
  onChangePreviewWidth: (w: PreviewWidth) => void;

  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;

  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;

  /** Public URL of the published form (e.g. /f/<slug>). Renders the "Open" link. */
  publicUrl?: string | null;
  /** Iframe embed snippet — when present, exposes a copy button. */
  embedSnippet?: string | null;

  outlineOpen?: boolean;
  onToggleOutline?: () => void;
}

// Form-specific action bar — drops the email's "Preview as Contact" picker
// and "Copy HTML" affordance. Adds copy-iframe-snippet + open-public-form
// links so the rep can quickly grab the embed code or visit the live URL.
export function FormActionBar({
  previewWidth,
  onChangePreviewWidth,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  publicUrl,
  embedSnippet,
  outlineOpen = false,
  onToggleOutline,
}: FormActionBarProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopySnippet = async () => {
    if (!embedSnippet) return;
    try {
      await navigator.clipboard.writeText(embedSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Browser clipboard denied — silently no-op. The settings page also
      // exposes the snippet as plain text so users can copy manually.
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--muted)] flex-shrink-0">
      {/* LEFT — Outline toggle + form name placeholder */}
      <div className="flex items-center gap-1.5 min-w-0">
        {onToggleOutline && (
          <button
            onClick={onToggleOutline}
            title="Outline (block structure)"
            className={`p-1.5 rounded ${
              outlineOpen
                ? 'bg-[var(--primary)] text-white'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
            }`}
          >
            <ListBulletIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* CENTER — Desktop / Mobile / Zoom */}
      <div className="flex items-center justify-center gap-1">
        <button
          onClick={() => onChangePreviewWidth('desktop')}
          title="Desktop"
          className={`p-1.5 rounded ${
            previewWidth === 'desktop'
              ? 'bg-[var(--primary)] text-white'
              : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
          }`}
        >
          <ComputerDesktopIcon className="w-4 h-4" />
        </button>
        <button
          onClick={() => onChangePreviewWidth('mobile')}
          title="Mobile (375px)"
          className={`p-1.5 rounded ${
            previewWidth === 'mobile'
              ? 'bg-[var(--primary)] text-white'
              : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
          }`}
        >
          <DevicePhoneMobileIcon className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-0.5 ml-1 pl-2 border-l border-[var(--border)]/70">
          <button
            onClick={onZoomOut}
            disabled={zoom <= 50}
            title="Zoom out"
            className="h-7 w-7 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-40 transition-colors"
          >
            <span className="text-sm font-semibold leading-none">-</span>
          </button>
          <button
            onClick={onZoomReset}
            title="Reset zoom"
            className="h-7 min-w-[46px] px-1 rounded text-[10px] font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            {zoom}%
          </button>
          <button
            onClick={onZoomIn}
            disabled={zoom >= 200}
            title="Zoom in"
            className="h-7 w-7 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-40 transition-colors"
          >
            <span className="text-sm font-semibold leading-none">+</span>
          </button>
        </div>
      </div>

      {/* RIGHT — Undo / Redo + Open / Copy snippet */}
      <div className="flex items-center justify-self-end gap-1.5">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (⌘Z)"
          className="p-1.5 rounded-lg bg-[var(--muted)] hover:bg-[var(--accent)] disabled:opacity-40 transition-colors"
        >
          <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (⌘⇧Z)"
          className="p-1.5 rounded-lg bg-[var(--muted)] hover:bg-[var(--accent)] disabled:opacity-40 transition-colors"
        >
          <ArrowUturnRightIcon className="w-3.5 h-3.5" />
        </button>
        {embedSnippet && (
          <button
            onClick={handleCopySnippet}
            title="Copy iframe embed snippet"
            className={`p-1.5 rounded-lg transition-colors ${
              copied
                ? 'text-green-500 bg-green-500/10'
                : 'hover:bg-[var(--muted)] text-[var(--muted-foreground)]'
            }`}
          >
            {copied ? <CheckIcon className="w-4 h-4" /> : <ClipboardIcon className="w-4 h-4" />}
          </button>
        )}
        {publicUrl && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open live form"
            className="p-1.5 rounded-lg hover:bg-[var(--muted)] text-[var(--muted-foreground)] transition-colors inline-flex"
          >
            <ArrowTopRightOnSquareIcon className="w-4 h-4" />
          </a>
        )}
      </div>
    </div>
  );
}
