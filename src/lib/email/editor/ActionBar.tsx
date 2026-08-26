'use client';

import * as React from 'react';
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  ArrowPathIcon,
  CheckIcon,
  ListBulletIcon,
  UserCircleIcon,
  EllipsisVerticalIcon,
  CodeBracketIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { PreviewContact } from '@/lib/preview-variables';

export type PreviewWidth = 'desktop' | 'mobile';

export interface ActionBarProps {
  previewContacts?: PreviewContact[];
  selectedContactId?: string | null;
  onSelectContact?: (id: string) => void;
  onReloadContacts?: () => void;
  contactsLoading?: boolean;

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

  onCopyHtml?: () => void;
  copied?: boolean;

  // Outline / structure popover
  outlineOpen?: boolean;
  onToggleOutline?: () => void;
}

export function ActionBar({
  previewContacts = [],
  selectedContactId = null,
  onSelectContact,
  onReloadContacts,
  contactsLoading = false,
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
  onCopyHtml,
  copied = false,
  outlineOpen = false,
  onToggleOutline,
}: ActionBarProps) {
  const [showMoreMenu, setShowMoreMenu] = React.useState(false);

  // Close menu on Esc + outside click
  React.useEffect(() => {
    if (!showMoreMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowMoreMenu(false);
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('[data-d2d-more-menu]')) {
        setShowMoreMenu(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [showMoreMenu]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--muted)] flex-shrink-0">
      {/* LEFT — Outline toggle + Preview As pill */}
      <div className="flex items-center gap-1.5 min-w-0">
        {onToggleOutline && (
          <button
            onClick={onToggleOutline}
            title="Outline (block structure)"
            className={`p-1.5 rounded ${
              outlineOpen
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
            }`}
          >
            <ListBulletIcon className="w-4 h-4" />
          </button>
        )}
        {onSelectContact && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--muted)]">
            <UserCircleIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
            <select
              value={selectedContactId || '__sample__'}
              onChange={(e) => onSelectContact(e.target.value)}
              className="w-[220px] max-w-[28vw] min-w-0 bg-transparent text-xs text-[var(--foreground)] focus:outline-none"
            >
              <option value="__sample__">Preview As: Sample</option>
              {previewContacts.map((c) => {
                const label =
                  c.fullName ||
                  [c.firstName, c.lastName].filter(Boolean).join(' ') ||
                  c.email ||
                  c.id;
                return (
                  <option key={c.id} value={c.id}>
                    {label}
                  </option>
                );
              })}
            </select>
            {onReloadContacts && (
              <button
                onClick={onReloadContacts}
                disabled={contactsLoading}
                title="Refresh contacts"
                className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40"
              >
                <ArrowPathIcon
                  className={`w-3.5 h-3.5 ${contactsLoading ? 'animate-spin' : ''}`}
                />
              </button>
            )}
          </div>
        )}
      </div>

      {/* CENTER — Desktop / Mobile / Zoom */}
      <div className="flex items-center justify-center gap-1">
        <button
          onClick={() => onChangePreviewWidth('desktop')}
          title="Desktop"
          className={`p-1.5 rounded ${
            previewWidth === 'desktop'
              ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
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
              ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
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

      {/* RIGHT — Undo / Redo + ⋮ More menu */}
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
        {onCopyHtml && (
          <>
            <div className="w-px h-5 bg-[var(--border)] mx-0.5" />
            <div className="relative" data-d2d-more-menu>
              <button
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                title="More actions"
                className={`p-1.5 rounded-lg transition-colors ${
                  copied
                    ? 'text-green-400 bg-green-500/10'
                    : 'hover:bg-[var(--muted)]'
                }`}
              >
                {copied ? (
                  <CheckIcon className="w-4 h-4" />
                ) : (
                  <EllipsisVerticalIcon className="w-4 h-4" />
                )}
              </button>
              {showMoreMenu && (
                <div className="absolute right-0 top-full mt-1 z-50 w-56 glass-dropdown">
                  <div className="px-3 pt-2 pb-1 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-[var(--muted-foreground)]">
                      Copy
                    </span>
                    <button
                      onClick={() => setShowMoreMenu(false)}
                      className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    >
                      <XMarkIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      onCopyHtml();
                      setShowMoreMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--accent)] transition-colors text-left"
                  >
                    <CodeBracketIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                    Compiled HTML
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

