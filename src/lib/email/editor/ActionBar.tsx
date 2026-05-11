'use client';

import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  ArrowPathIcon,
  Square2StackIcon,
  CheckIcon,
  ListBulletIcon,
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

const iconBtnClass =
  'h-8 min-w-[32px] inline-flex items-center justify-center px-2 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-40 disabled:hover:bg-transparent transition-colors';

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
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--card)] flex-shrink-0">
      {/* LEFT — Outline toggle + Preview as contact */}
      <div className="flex items-center gap-2 min-w-0">
        {onToggleOutline && (
          <button
            onClick={onToggleOutline}
            title="Outline (block structure)"
            className={
              outlineOpen
                ? 'h-8 w-9 inline-flex items-center justify-center rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] transition-colors flex-shrink-0'
                : 'h-8 w-9 inline-flex items-center justify-center rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors flex-shrink-0'
            }
          >
            <ListBulletIcon className="w-4 h-4" />
          </button>
        )}
        {onSelectContact && (
          <div className="flex items-center gap-2 px-3 py-1.5 border border-[var(--border)] rounded-md bg-[var(--background)] min-w-0">
            <span className="text-xs font-medium text-[var(--muted-foreground)] whitespace-nowrap">
              Preview as
            </span>
            <select
              value={selectedContactId || '__sample__'}
              onChange={(e) => onSelectContact(e.target.value)}
              className="text-sm bg-transparent border-0 px-1 py-0.5 text-[var(--foreground)] outline-none font-medium cursor-pointer min-w-0 max-w-[180px] truncate"
            >
              <option value="__sample__">Sample</option>
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
                className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40 transition-colors"
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
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChangePreviewWidth('desktop')}
          title="Desktop"
          className={
            previewWidth === 'desktop'
              ? 'h-8 w-9 inline-flex items-center justify-center rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] transition-colors'
              : 'h-8 w-9 inline-flex items-center justify-center rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors'
          }
        >
          <ComputerDesktopIcon className="w-4 h-4" />
        </button>
        <button
          onClick={() => onChangePreviewWidth('mobile')}
          title="Mobile (375px)"
          className={
            previewWidth === 'mobile'
              ? 'h-8 w-9 inline-flex items-center justify-center rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] transition-colors'
              : 'h-8 w-9 inline-flex items-center justify-center rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors'
          }
        >
          <DevicePhoneMobileIcon className="w-4 h-4" />
        </button>
        <span className="w-px h-5 bg-[var(--border)] mx-1.5" />
        <button
          onClick={onZoomOut}
          disabled={zoom <= 50}
          title="Zoom out"
          className={iconBtnClass}
        >
          <span className="text-base font-semibold leading-none">−</span>
        </button>
        <button
          onClick={onZoomReset}
          title="Reset zoom"
          className={`${iconBtnClass} min-w-[52px] text-xs font-semibold`}
        >
          {zoom}%
        </button>
        <button
          onClick={onZoomIn}
          disabled={zoom >= 200}
          title="Zoom in"
          className={iconBtnClass}
        >
          <span className="text-base font-semibold leading-none">+</span>
        </button>
      </div>

      {/* RIGHT — Undo / Redo / Copy */}
      <div className="flex items-center gap-1 justify-end">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (⌘Z)"
          className={iconBtnClass}
        >
          <ArrowUturnLeftIcon className="w-4 h-4" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (⌘⇧Z)"
          className={iconBtnClass}
        >
          <ArrowUturnRightIcon className="w-4 h-4" />
        </button>
        {onCopyHtml && (
          <>
            <span className="w-px h-5 bg-[var(--border)] mx-1.5" />
            <button
              onClick={onCopyHtml}
              title="Copy compiled HTML"
              className={
                copied
                  ? 'h-8 min-w-[32px] inline-flex items-center justify-center px-2 rounded-md text-emerald-500 bg-emerald-500/10 transition-colors'
                  : iconBtnClass
              }
            >
              {copied ? <CheckIcon className="w-4 h-4" /> : <Square2StackIcon className="w-4 h-4" />}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
