'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowsRightLeftIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';

interface SelectedTemplatePanelProps {
  htmlContent: string;
  onEdit: () => void;
  onChangeTemplate: () => void;
}

/**
 * Right-column display once an email template is loaded onto the campaign.
 * Iframe preview of the compiled HTML, an Edit button that hands off to
 * the existing template editor, and a "..." dropdown with Change template.
 */
export function SelectedTemplatePanel({
  htmlContent,
  onEdit,
  onChangeTemplate,
}: SelectedTemplatePanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  return (
    <div className="glass-section-card rounded-2xl border border-[var(--border)] overflow-hidden flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border)]">
        <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
          Preview
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 px-3 h-8 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/60"
          >
            <PencilSquareIcon className="w-3.5 h-3.5" />
            Edit
          </button>
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]"
              aria-label="Template options"
            >
              <EllipsisVerticalIcon className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 min-w-[180px] glass-dropdown p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onChangeTemplate();
                  }}
                  className="w-full text-left px-3 py-2 text-xs rounded-md text-[var(--foreground)] hover:bg-[var(--muted)] inline-flex items-center gap-2"
                >
                  <ArrowsRightLeftIcon className="w-3.5 h-3.5" />
                  Change template
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="bg-[var(--muted)]/30 p-4 flex-1 min-h-[600px]">
        <iframe
          title="Blast preview"
          srcDoc={htmlContent}
          sandbox=""
          className="w-full h-full min-h-[580px] bg-white rounded-lg border border-[var(--border)]"
        />
      </div>
    </div>
  );
}
